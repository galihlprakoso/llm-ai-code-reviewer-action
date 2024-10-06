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

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url)
  return await resp.text()
}

export async function getRepoStructure(
  path = '',
  ref: string | undefined = undefined
): Promise<string> {
  try {
    const { data: contents } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref
    })

    let markdownStructure = ''
    if (Array.isArray(contents)) {
      for (const item of contents) {
        const indentLevel = path.split('/').length - 1
        const indent = '  '.repeat(indentLevel)

        if (item.type === 'dir') {
          markdownStructure += `${indent}- 📁 **${item.name}**\n`
          // Recursively get contents of the folder
          markdownStructure += await getRepoStructure(item.path)
        } else if (item.type === 'file') {
          markdownStructure += `${indent}- 📄 ${item.name}\n`
        }
      }
    }
    return markdownStructure
  } catch (error) {
    console.error('Error fetching repository contents:', error)
    return ''
  }
}

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
    console.error('Error reading directory:', error)
    return ''
  }

  return markdownStructure
}

export async function getFileContent(path: string): Promise<string> {
  const { data: contents } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref: context.payload.pull_request!.head.ref,
    mediaType: {
      format: 'raw'
    }
  })

  if (Array.isArray(contents) && contents.length > 0) {
    return contents[0].content || ''
  }

  return ''
}

export async function getReadme(): Promise<string> {
  try {
    const { data: readmeData } = await octokit.repos.getReadme({
      owner,
      repo,
      mediaType: {
        format: 'raw'
      }
    })

    return readmeData.content || ''
  } catch {
    return ''
  }
}

export function shouldReview(): boolean {
  return context.payload.pull_request === undefined
}

export async function commentOnPullRequest(
  comment: string,
  path: string,
  position: number
): Promise<void> {
  core.info(
    `Commenting on pull request. Path: ${path}, Position: ${position}, Comment: ${comment}`
  )

  const prDetails = await octokit.pulls.get({ owner, repo, pull_number })

  await octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number,
    body: comment,
    commit_id: prDetails.data.head.sha,
    path,
    position
  })
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

export async function getPullRequestContext(): Promise<string> {
  const readme = await getReadme()

  core.debug(`[readme] - ${readme}`)

  const headRefFolderStructure = await getLocalRepoStructure(
    GITHUB_WORKSPACE,
    context.payload.pull_request!.head.ref
  )

  core.debug(`[headRefFolderStructure] - ${headRefFolderStructure}`)

  const prDetails = await octokit.pulls.get({ owner, repo, pull_number })

  const diff = await fetchText(prDetails.data.diff_url)

  // const reviews = await octokit.pulls.listReviews({
  //   pull_number,
  //   owner,
  //   repo
  // })

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
==================== Pull Request Diff ====================
${diff}
===================================================`
}
