import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import * as path from 'path'
import { PullRequestReviewComment } from './types'

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN', { required: true })
const GITHUB_WORKSPACE = core.getInput('GITHUB_WORKSPACE', { required: true })
const octokit = github.getOctokit(GITHUB_TOKEN).rest
const context = github.context

const CONTENT_NOT_FOUND = 'CONTENT_NOT_FOUND'
const EVENT_NAME_PULL_REQUEST = 'pull_request'
const PAYLOAD_ACTION_PULL_REQUEST_OPENED = 'opened'
const PAYLOAD_ACTION_PULL_REQUEST_SYNC = 'synchronize'
const PAYLOAD_ACTION_PULL_REQUEST_REOPENED = 'reopened'

const EVENT_NAME_PULL_REQUEST_REVIEW_COMMENT = 'pull_request_review_comment'
const PAYLOAD_ACTION_PULL_REQUEST_REVIEW_COMMENT_CREATED = 'created'
const PAYLOAD_ACTION_PULL_REQUEST_REVIEW_COMMENT_SYNC = 'edited'

const owner = context.repo.owner
const repo = context.repo.repo
const pull_number = context.payload.pull_request?.number || 0

core.debug(
  `[GITHUB] - context: ${JSON.stringify({
    owner,
    repo,
    pull_number
  })}`
)

export async function getLocalRepoStructure(
  dirPath: string,
  currentPath = ''
): Promise<string> {
  let markdownStructure = ''

  try {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const item of items) {
      const itemPath = path.join(dirPath, item.name)
      const relativeItemPath = path.join(currentPath, item.name)
      const indentLevel = relativeItemPath.split(path.sep).length - 1
      const indent = '  '.repeat(indentLevel)

      if (item.isDirectory()) {
        markdownStructure += `${indent}- 📁 **${item.name}**\n`
        markdownStructure += await getLocalRepoStructure(
          itemPath,
          relativeItemPath
        )
      } else if (item.isFile()) {
        markdownStructure += `${indent}- 📄 ${item.name}\n`
      }
    }
  } catch (error) {
    core.debug(
      `[GITHUB] - getLocalRepoStructure: ${(error as Error).message}`
    )
    return ''
  }

  return markdownStructure
}

export async function getFileContent(path: string): Promise<string> {
  try {
    core.debug(`[GITHUB] - getFileContent - path:${path}`)

    const response = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: context.payload.pull_request!.head.ref,
      mediaType: {
        format: 'raw'
      }
    })

    core.debug(`[GITHUB] - getFileContent - ${JSON.stringify(response)}`)

    return response.data.toString()
  } catch (err) {
    core.debug(
      `[GITHUB] - getFileContent -  Error: ${(err as Error).message}`
    )

    return CONTENT_NOT_FOUND
  }
}

export async function getReadme(): Promise<string> {
  const response = await octokit.repos.getReadme({
    owner,
    repo,
    mediaType: {
      format: 'raw'
    }
  })

  core.debug(`[GITHUB] - getReadme - ${JSON.stringify(response)}`)

  return response.data.toString()
}

export function isNeedToReviewPullRequest(): boolean {
  return (
    context.eventName === EVENT_NAME_PULL_REQUEST &&
    [
      PAYLOAD_ACTION_PULL_REQUEST_OPENED,
      PAYLOAD_ACTION_PULL_REQUEST_SYNC,
      PAYLOAD_ACTION_PULL_REQUEST_REOPENED
    ].includes(context.payload.action || '')
  )
}

export function isNeedToReplyReviewComments(): boolean {
  return (
    context.eventName === EVENT_NAME_PULL_REQUEST_REVIEW_COMMENT &&
    [
      PAYLOAD_ACTION_PULL_REQUEST_REVIEW_COMMENT_CREATED,
      PAYLOAD_ACTION_PULL_REQUEST_REVIEW_COMMENT_SYNC
    ].includes(context.payload.action || '')
  )
}

export async function submitReview(
  review_summary: string,
  comments: PullRequestReviewComment[],
  action: 'REQUEST_CHANGES' | 'APPROVE' | 'COMMENT'
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    body: review_summary,
    comments: comments.map(comment => ({
      body: comment.comment,
      path: comment.path,
      position: comment.position
    })),
    event: action
  })
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function getListFiles() {
  const listFiles = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number
  })

  return listFiles.data
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function getListReviewComments() {
  const listReviewComments = await octokit.pulls.listReviewComments({
    owner,
    repo,
    pull_number
  })

  return listReviewComments.data
}

export async function getPullRequestContext(): Promise<string> {
  const readme = await getReadme()

  core.debug(`[readme] - ${readme}`)

  const headRefFolderStructure = await getLocalRepoStructure(
    GITHUB_WORKSPACE,
    context.payload.pull_request!.head.ref
  )

  core.debug(`[headRefFolderStructure] - ${headRefFolderStructure}`)

  const prDetails = await octokit.pulls.get({ owner, repo, pull_number })

  const listFiles = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number
  })

  const listReviews = await octokit.pulls.listReviews({
    pull_number,
    owner,
    repo
  })

  const listReviewComments = await octokit.pulls.listReviewComments({
    pull_number,
    owner,
    repo
  })

  const topLevelComments = listReviewComments.data.filter(
    comment => !comment.in_reply_to_id
  )
  const replies = listReviewComments.data.filter(
    comment => !!comment.in_reply_to_id
  )

  const repliesMap: Record<string, typeof listReviewComments.data> = {}

  topLevelComments.forEach(comment => {
    repliesMap[comment.id] = []
  })

  replies.forEach(reply => {
    repliesMap[reply.in_reply_to_id!].push(reply)
  })

  core.debug(`[pullRequestDetail] - ${JSON.stringify(prDetails.data)}`)

  return `==================== README.md ====================
${readme}
===================================================
==================== Source Branch Folder Structure ====================
${headRefFolderStructure}
===================================================
==================== Pull Request Info ====================
Title: ${prDetails.data.title}
Description: ${prDetails.data.body}
Mergeable: ${prDetails.data.mergeable ? 'YES' : 'NO'}
Mergeable State: ${prDetails.data.mergeable_state}
Changed Files: ${prDetails.data.changed_files}
===================================================
==================== Pull Request Changes Patches ====================
${listFiles.data.map(
  file => `=== ${path} ===
${(file.patch || '').substring(0, 1000)}
======\n`
)}
===================================================
==================== Pull Request Reviews ====================
${listReviews.data.map(review => `- By: ${review.user?.name}, Body: ${review.body}\n`)}
===================================================
==================== Pull Request Review Comments ====================
${topLevelComments.map(
  review => `======= By: ${review.user?.name} =======
Body: ${review.body}}
Replies:
${repliesMap[review.id].map(reply => `- By: ${reply.user?.name}, Body: ${reply.body}\n`)}
=================  
`
)}
===================================================`
}

export async function getAuthenticatedUserLogin(): Promise<string> {
  const { data: authenticatedUser } = await octokit.users.getAuthenticated()
  return authenticatedUser.login
}

export async function replyToReviewComment(
  topLevelCommentId: number,
  replyBody: string
): Promise<void> {
  await octokit.pulls.createReplyForReviewComment({
    owner,
    repo,
    pull_number,
    comment_id: topLevelCommentId,
    body: replyBody
  })
}
