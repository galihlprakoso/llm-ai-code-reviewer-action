import * as core from '@actions/core'
import * as github from '@actions/github'
import * as fs from 'fs'
import * as path from 'path'
import { PullRequestReviewComment } from './types'

const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN', { required: true })
const GITHUB_WORKSPACE = core.getInput('GITHUB_WORKSPACE', { required: true })
const octokit = github.getOctokit(GITHUB_TOKEN).rest
const context = github.context

const owner = context.repo.owner
const repo = context.repo.repo
const pull_number = context.payload.pull_request?.number || 0

core.debug(
  `[github.ts] - context: ${JSON.stringify({
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
      `[github.ts] - getLocalRepoStructure: ${(error as Error).message}`
    )
    return ''
  }

  return markdownStructure
}

export async function getFileContent(path: string): Promise<string> {
  core.debug(`[github.ts] - getFileContent - path:${path}`)

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: context.payload.pull_request!.head.ref,
    mediaType: {
      format: 'raw'
    }
  })

  core.debug(`[github.ts] - getFileContent - ${JSON.stringify(response)}`)

  return response.data.toString()
}

export async function getReadme(): Promise<string> {
  const response = await octokit.repos.getReadme({
    owner,
    repo,
    mediaType: {
      format: 'raw'
    }
  })

  core.debug(`[github.ts] - getReadme - ${JSON.stringify(response)}`)

  return response.data.toString()
}

export function shouldReview(): boolean {
  return context.payload.pull_request === undefined
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
  file => `--- ${path} ---
${(file.patch || '').substring(0, 1000)}
------\n`
)}
===================================================
==================== Pull Request Reviews ====================
${listReviews.data.map(review => `- By: ${review.user?.name}, Body: ${review.body}}\n`)}
===================================================
==================== Pull Request Review Comments ====================
${listReviewComments.data.map(review => `- By: ${review.user?.name}, Body: ${review.body}}, Path: ${review.path}, Position: ${review.position}\n`)}
===================================================`
}
