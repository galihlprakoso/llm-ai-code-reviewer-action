import * as core from '@actions/core'
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage
} from '@langchain/core/messages'
import { END, START, StateGraph } from '@langchain/langgraph'
import { MemorySaver, Annotation } from '@langchain/langgraph'
import { ChatGroq } from '@langchain/groq'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { exit } from 'process'
import { getPullRequestContext, submitReview } from './github'
import { z } from 'zod'
import {
  analysisToolsNode,
  analysisTools,
  knowledgeBaseTools,
  knowledgeBaseToolsNode,
  fileSelecterAgentTools,
  fileSelecterAgentToolsNode
} from './llm_tools'
import { PullRequestReviewComment } from './types'

const AI_PROVIDER = core.getInput('ai_provider', {
  required: true,
  trimWhitespace: true
})
const AI_PROVIDER_MODEL = core.getInput('ai_provider_model', {
  required: true,
  trimWhitespace: true
})
const CODEBASE_HIGH_OVERVIEW_DESCRIPTION = core.getInput(
  'codebase_high_overview_descripton',
  {
    required: true,
    trimWhitespace: false
  }
)
const GOOGLE_GEMINI_API_KEY = core.getInput('GOOGLE_GEMINI_API_KEY', {
  required: false,
  trimWhitespace: true
})
const GROQ_API_KEY = core.getInput('GROQ_API_KEY', {
  required: false,
  trimWhitespace: true
})

const AI_PROVIDER_GROQ = 'GROQ'
const AI_PROVIDER_GEMINI = 'GEMINI'

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  }),
  comments: Annotation<PullRequestReviewComment[]>({
    reducer: (x, y) => x.concat(y),
    default: () => []
  })
})

function getModel(): BaseChatModel {
  let model: BaseChatModel | undefined

  if (AI_PROVIDER === AI_PROVIDER_GROQ && GROQ_API_KEY) {
    model = new ChatGroq({
      model: AI_PROVIDER_MODEL,
      temperature: 0,
      maxTokens: undefined,
      maxRetries: 2,
      apiKey: GROQ_API_KEY
    })
  } else if (AI_PROVIDER === AI_PROVIDER_GEMINI && GOOGLE_GEMINI_API_KEY) {
    model = new ChatGoogleGenerativeAI({
      model: AI_PROVIDER_MODEL,
      apiKey: GOOGLE_GEMINI_API_KEY,
      temperature: 0,
      maxRetries: 2
    })
  } else {
    core.setFailed(`API KEY for provider: ${AI_PROVIDER} is not provided!`)
    exit(1)
  }

  return model
}

async function callInputUnderstandingAgent(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _state: typeof StateAnnotation.State
): Promise<
  | {
      messages: AIMessageChunk[]
    }
  | undefined
> {
  core.info('[LLM] - Understanding the input...')

  const pullRequestContext = await getPullRequestContext()

  const model = getModel()
  const modelWithTools = model.bindTools!(analysisTools)

  const response = await modelWithTools.invoke([
    new SystemMessage(`You are an AI Agent that help human to do code review, you are one of the agents that have a task to answer these questions under two sections based on given repository informations:
  - Understanding given repository information (e.g README file, folder structure, etc.)
    - What framework is used?
    - What kind of coding styles are used?
    - What design patterns are used?
  - Understanding given pull request information
    - What's the intention of the pull request?
    - What kind of changes introduced in this pull request?
    - What's the impact of this pull request?
  - Understanding the business / domain logic context?
    - What's the high overview of the business / domain in this repository?
    - What's the high overview about the business / domain logic?

You can use available tools to enrich your answer to those questions.`),
    new HumanMessage(`# Codebase High Overview Description
${CODEBASE_HIGH_OVERVIEW_DESCRIPTION}
# Repository and Pull Request Information
${pullRequestContext}`)
  ])

  return { messages: [response] }
}

async function callKnowledgeBaseGathererAgent(
  state: typeof StateAnnotation.State
): Promise<
  | {
      messages: AIMessageChunk[]
    }
  | undefined
> {
  core.info('[LLM] - Gathering knowledge base...')

  const model = getModel()
  const modelWithTools = model.bindTools!(knowledgeBaseTools)

  const response = await modelWithTools.invoke([
    new SystemMessage(`You are an AI Agent that help human to do code review, you are one of the agents that have a task to gather additional knowledge needed
based on given informations given by previous AI agent (previous agent was doing input analysis: understanding the repository and pull request information). You should use given tools to gather all knowledge that will be passed to next agent. You will need to gather knowledge for each of this topic based on given information by previous agent:
- Design Pattern Guide
- Coding Style Guide
- Business / Domain Knowledge Guide`),
    ...state.messages
  ])

  return { messages: [response] }
}

async function callFileSelectorAgent(
  state: typeof StateAnnotation.State
): Promise<
  | {
      messages: AIMessageChunk[]
    }
  | undefined
> {
  const model = getModel()
  const modelWithTools = model.bindTools!(fileSelecterAgentTools)

  const response = await modelWithTools.invoke([
    new SystemMessage(`You are an AI agent that help human to review code, you are one of agents that have specific task which is to select interesting file to be reviewed.
Don't choose file that's impossible to review (image file, dist generated file, node_modules file, blob, or any other non-reviewable and non-code files.)
You can utilize these available tools to gather more information about specific file you interested:
- "get_file_changes_patch" - this tool will give you diff changes between source and target branch for the specific file.
- "get_file_full_content" - when patch is not enough, you can also use this tool to get full content of that file.`),
    ...state.messages
  ])

  return { messages: [response] }
}

async function callReviewCommentAgentNode(
  state: typeof StateAnnotation.State
): Promise<
  | {
      comments: PullRequestReviewComment[]
    }
  | undefined
> {
  const model = getModel()
  const modelWithStructuredOutput = model.withStructuredOutput(
    z.object({
      comments: z
        .array(
          z.object({
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
                'The position in the diff / patch where you want to add a review comment. Note this value is not the same as the line number in the file. The position value equals the number of lines down from the first "@@" hunk header in the file you want to add a comment. The line just below the "@@" line is position 1, the next line is position 2, and so on. The position in the diff continues to increase through lines of whitespace and additional hunks until the beginning of a new file.'
              )
          })
        )
        .describe('Array of review comments.')
    })
  )

  const response = await modelWithStructuredOutput.invoke([
    new SystemMessage(`You are an AI agent that help human to do code review, you are one of the agents that have task to create review comments based on given informations provided by previous agents' conversations.
You should give me list of review comments in a structured output.`),
    ...state.messages
  ])

  return { comments: response.comments }
}

async function callReviewSummaryAgentNode(
  state: typeof StateAnnotation.State
): Promise<
  | {
      messages: AIMessageChunk[]
    }
  | undefined
> {
  const model = getModel()
  const modelWithStructuredOutput = model.withStructuredOutput(
    z.object({
      review_summary: z.string().describe('Your PR Review summarization.'),
      review_action: z
        .enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT'])
        .describe(
          'The review action you want to perform. The review actions include: APPROVE, REQUEST_CHANGES, or COMMENT.'
        )
    })
  )

  const response = await modelWithStructuredOutput.invoke([
    new SystemMessage(`You are an AI agent that help human to do code review, you are one of the agents that have task to create review summary and define review action type based on given informations provided by previous agents' conversations.
You must create review summary, and decide the review action type.`),
    ...state.messages
  ])

  await submitReview(
    response.review_summary,
    state.comments,
    response.review_action
  )

  return { messages: [] }
}

const workflow = new StateGraph(StateAnnotation)
  .addNode('input_understanding_agent', callInputUnderstandingAgent)
  .addNode('analysis_tools', analysisToolsNode)
  .addNode('knowledge_base_tools', knowledgeBaseToolsNode)
  .addNode('file_selector_agent_tools', fileSelecterAgentToolsNode)
  .addNode('knowledge_base_gatherer_agent', callKnowledgeBaseGathererAgent)
  .addNode('file_selector_agent', callFileSelectorAgent)
  .addNode('code_review_comment_agent', callReviewCommentAgentNode)
  .addNode('code_review_summary_agent', callReviewSummaryAgentNode)
  .addEdge(START, 'input_understanding_agent')
  .addConditionalEdges(
    'input_understanding_agent',
    (state: typeof StateAnnotation.State) => {
      const messages = state.messages
      const lastMessage = messages[messages.length - 1] as AIMessage

      if (lastMessage.tool_calls?.length) {
        return 'analysis_tools'
      }
      return 'knowledge_base_gatherer_agent'
    }
  )
  .addEdge('analysis_tools', 'input_understanding_agent')
  .addConditionalEdges(
    'knowledge_base_gatherer_agent',
    (state: typeof StateAnnotation.State) => {
      const messages = state.messages
      const lastMessage = messages[messages.length - 1] as AIMessage

      if (lastMessage.tool_calls?.length) {
        return 'knowledge_base_tools'
      }
      return 'file_selector_agent'
    }
  )
  .addEdge('knowledge_base_tools', 'knowledge_base_gatherer_agent')
  .addConditionalEdges(
    'file_selector_agent',
    (state: typeof StateAnnotation.State) => {
      const messages = state.messages
      const lastMessage = messages[messages.length - 1] as AIMessage

      if (lastMessage.tool_calls?.length) {
        return 'file_selector_agent_tools'
      }
      return 'code_review_comment_agent'
    }
  )
  .addEdge('file_selector_agent_tools', 'file_selector_agent')
  .addEdge('code_review_comment_agent', 'code_review_summary_agent')
  .addEdge('code_review_summary_agent', END)

const checkpointer = new MemorySaver()

const graph = workflow.compile({ checkpointer })

export async function reviewPullRequest(): Promise<void> {
  await graph.invoke(
    {
      messages: [new HumanMessage('Please review my pull request.')]
    },
    { configurable: { thread_id: '42' }, recursionLimit: 4, }
  )
}
