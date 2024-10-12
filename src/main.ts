import * as core from '@actions/core'
import { shouldReview } from './github'
import { reviewPullRequest } from './llm'

export async function run(): Promise<void> {
  if (shouldReview()) {
    core.setFailed('This action can only be triggered by a pull request event.')
    return
  }

  try {
    await reviewPullRequest()
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}
