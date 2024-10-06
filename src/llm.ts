import * as core from '@actions/core'
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage
} from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { START, StateGraph } from '@langchain/langgraph'
import { MemorySaver, Annotation } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatGroq } from '@langchain/groq'
import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { getFileContent, submitReview } from './github'
import { PullRequestReviewComment } from './types'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'

const AI_PROVIDER = core.getInput('ai_provider', {
  required: true,
  trimWhitespace: true
})
const AI_PROVIDER_MODEL = core.getInput('ai_provider_model', {
  required: true,
  trimWhitespace: true
})
const GOOGLE_GEMINI_API_KEY = core.getInput('GOOGLE_GEMINI_API_KEY', {
  required: false,
  trimWhitespace: true
})
const GROQ_API_KEY = core.getInput('GROQ_API_KEY', {
  required: false,
  trimWhitespace: true
})
const TAVILY_API_KEY = core.getInput('TAVILY_API_KEY', {
  required: false,
  trimWhitespace: true
})

const TOOL_RESPONSE_SUCCESS = 'SUCCESS'
const TOOL_RESPONSE_FAILED = 'FAILED'

const AI_PROVIDER_GROQ = 'GROQ'
const AI_PROVIDER_GEMINI = 'GEMINI'

const comments: PullRequestReviewComment[] = []

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y)
  })
})

const commentPullRequestTool = tool(
  async ({ comment, path, position }) => {
    core.debug(`[comment_pull_request]: called!`)

    comments.push({
      comment: `${comment}\n\nReviewed by: [ai-code-review-action](https://github.com/galihlprakoso/ai-code-reviewer-action)`,
      path,
      position
    })

    core.debug(`[comment_pull_request]: ${TOOL_RESPONSE_SUCCESS}`)

    return TOOL_RESPONSE_SUCCESS
  },
  {
    name: 'comment_pull_request',
    description:
      'Call to add commment to pull request. It will return FAILED when the action failed, and SUCCESS when the action succeed.',
    schema: z.object({
      comment: z
        .string()
        .describe('Your comment to specific file and position.'),
      path: z
        .string()
        .describe(
          'Path to file (e.g <folder name>/<file name>.<file extension>'
        ),
      position: z
        .number()
        .describe(
          'The position in the diff where you want to add a review comment. Note this value is not the same as the line number in the file. The position value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.'
        )
    })
  }
)

const submitReviewTool = tool(
  async ({ review_summary, review_action }) => {
    try {
      core.debug(`[submit_review]: called!`)

      submitReview(review_summary, comments, review_action)

      core.debug(`[submit_review]: ${TOOL_RESPONSE_SUCCESS}!`)
      return TOOL_RESPONSE_SUCCESS
    } catch (err) {
      core.debug(
        `[submit_review]: ${TOOL_RESPONSE_FAILED}!. Err: ${(err as Error).message}`
      )
      return TOOL_RESPONSE_FAILED
    }
  },
  {
    name: 'submit_review',
    description:
      'Call to submit your review with all previously added comments.. It will return FAILED when the action failed, and SUCCESS when the action succeed.',
    schema: z.object({
      review_summary: z.string().describe('Your PR Review summarization.'),
      review_action: z
        .enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'])
        .describe(
          'The review action you want to perform. The review actions include: APPROVE, REQUEST_CHANGES, or COMMENT.'
        )
    })
  }
)

const getFileContentTool = tool(
  async ({ path }) => {
    try {
      core.debug(`[get_file_content]: called!`)

      const fileContent = await getFileContent(path)

      core.debug(
        `[get_file_content]: ${TOOL_RESPONSE_SUCCESS}. fileContent: ${fileContent}`
      )
      return fileContent
    } catch (err) {
      core.debug(
        `[get_file_content]: ${TOOL_RESPONSE_FAILED}. fileContent: ${(err as Error).message}`
      )
      return 'NOT_FOUND'
    }
  },
  {
    name: 'get_file_content',
    description:
      'Call to get the content of specific file in the source branch to enrich your decision before reviewing specific line on that file. It will return NOT_FOUND if the file is not exists.',
    schema: z.object({
      path: z
        .string()
        .describe(
          'Path to file (e.g <folder name>/<file name>.<file extension>'
        )
    })
  }
)

const tools = [
  commentPullRequestTool,
  getFileContentTool,
  submitReviewTool,
  ...(TAVILY_API_KEY
    ? [new TavilySearchResults({ maxResults: 3, apiKey: TAVILY_API_KEY })]
    : [])
]
const toolNode = new ToolNode(tools)

function shouldContinue(state: typeof StateAnnotation.State): string {
  const messages = state.messages
  const lastMessage = messages[messages.length - 1] as AIMessage

  if (lastMessage.tool_calls?.length) {
    return 'tools'
  }

  return '__end__'
}

async function callModel(state: typeof StateAnnotation.State): Promise<
  | {
      messages: AIMessageChunk[]
    }
  | undefined
> {
  let model

  if (AI_PROVIDER === AI_PROVIDER_GROQ && GROQ_API_KEY) {
    model = new ChatGroq({
      model: AI_PROVIDER_MODEL,
      temperature: 0,
      maxTokens: undefined,
      maxRetries: 2,
      apiKey: GROQ_API_KEY
    }).bindTools(tools)
  } else if (AI_PROVIDER === AI_PROVIDER_GEMINI && GOOGLE_GEMINI_API_KEY) {
    model = new ChatGoogleGenerativeAI({
      model: AI_PROVIDER_MODEL,
      apiKey: GOOGLE_GEMINI_API_KEY,
      temperature: 0,
      maxRetries: 2
    }).bindTools(tools)
  } else {
    core.setFailed(`API KEY for provider: ${AI_PROVIDER} is not provided!`)
    return
  }

  const messages = state.messages
  const response = await model.invoke(messages)

  return { messages: [response] }
}

const workflow = new StateGraph(StateAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent')

const checkpointer = new MemorySaver()

const app = workflow.compile({ checkpointer })

export async function reviewPullRequest(
  pull_request_context: string
): Promise<void> {
  core.debug(
    `[reviewPullRequest]: called. pull_request_context: ${pull_request_context}`
  )

  const messages = await app.invoke(
    {
      messages: [
        new SystemMessage(
          `You are an AI Assistant that help developer to do code review on their pull requests.
You MUST call the "comment_pull_request" function to add comment to specific line on some files. And you MUST call
the "get_file_content" tool to enrich your feedback before adding any comment using the "comment_pull_request" tool.
Your comment is not directly published, after you've done adding your review comments, you MUST call the "submit_review" tool,
and please provide your overall review summarization on that tool's parameter along with the action you want to perform.

The sequence of tool calling is:
1. get_file_content. to get content of specific file. ${TAVILY_API_KEY ? 'and maybe the Tavily search tool to browse the internet if you need additional information from the internet.' : ''}
2. comment_pull_request. to submit comment on specific file and specific position.
3. submit_review. after you've done iterationg on number 1 and 2. You MUST call this before ending your job as an assistant. Calling
to this function is mandatory.

Please review based on these points from Uncle Bob's guideline about clean code:
1. **Meaningful names**
2. **Functions should be small**
3. **Single Responsibility Principle (SRP)**
4. **Avoid long argument lists**
5. **DRY (Don’t Repeat Yourself)**
6. **Prefer descriptive over clever code**
7. **Avoid deeply nested structures**
8. **Write self-documenting code**
9. **Use clear and consistent formatting**
10. **Keep comments minimal and relevant**
11. **Code should express the intent clearly**
12. **Minimize dependencies**
13. **Error handling should not obscure logic**
14. **Follow proper object-oriented design principles**
15. **Write tests for your code (TDD)**
16. **Avoid magic numbers and hardcoded values**
17. **Refactor regularly**
18. **Keep code simple and avoid over-engineering**
19. **Use meaningful and precise comments if necessary**
20. **Class and function names should reveal intent**
21. **Separate concerns across modules and classes**
22. **Keep functions pure (avoid side effects)**
23. **Optimize for readability, not cleverness**
24. **Code should be consistent with the surrounding codebase**`
        ),
        new HumanMessage(
          `Pull Request Context:
${pull_request_context}`
        )
      ]
    },
    { configurable: { thread_id: '42' } }
  )

  core.debug(
    `[reviewPullRequest]: Success. comments:${JSON.stringify(comments)}`
  )
  core.debug(
    `[reviewPullRequest]: Success. messages:${JSON.stringify(messages)}`
  )
}
