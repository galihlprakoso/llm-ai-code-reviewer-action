import * as core from '@actions/core'
import { getPullRequestContext, shouldReview } from './github'
import { reviewPullRequest } from './llm'

export async function run(): Promise<void> {
  if (shouldReview()) {
    core.setFailed('This action can only be triggered by a pull request event.')
    return
  }

  try {
    const pullRequestContext = await getPullRequestContext()
    await reviewPullRequest(pullRequestContext)
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}
