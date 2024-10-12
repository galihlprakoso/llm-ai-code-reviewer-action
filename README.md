# AI Code Reviewer - GitHub Action

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**AI Code Reviewer - GitHub Action** is a powerful tool for automating code
reviews using AI, with support for multiple models and dynamic code analysis.
Leveraging the power of LangGraph in LangChain, this action allows for
intelligent and dynamic tool usage by incorporating the concept of Agents,
making the code review process more flexible and adaptive. Currently, it
supports Google’s **Gemini** model and **Groq**, with more models and providers
to be added in the future.

## Features

### 🔍 Dynamic Code Review with LangGraph and Agents

This GitHub Action utilizes LangChain's **LangGraph** and **Agent** concepts to
perform dynamic code reviews. The action can call multiple tools during the
review process, adapting to the specific needs of the code being reviewed. This
allows for more insightful and intelligent code analysis, going beyond static
linting.

### 🌐 Multiple Model Support

The action currently supports multiple AI models, allowing for flexibility in
choosing the model best suited for your codebase. Currently supported models:

- **Google Gemini**
- **Groq**

More models and providers will be added in future versions to ensure
comprehensive support across different AI ecosystems.

### 🚀 Easy Integration

This action can be easily integrated into your existing CI/CD workflows. Simply
add it to your GitHub Actions pipeline, and it will automatically analyze your
code using the configured AI models, providing feedback and suggestions for
improvement.

### 🛠️ Extensible Design

With the use of LangChain, this action is designed to be extensible, allowing
you to add custom tools and models. This flexibility makes it possible to tailor
the code review process to meet your team’s unique requirements.

## Usage

To use this action in your workflow, add the following configuration to your
GitHub Actions YAML file:

```yaml
name: AI Code Review

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  ai-code-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run AI Code Review
        uses: galihlprakoso/llm-ai-code-reviewer-action@v1.0.3
        with:
          ai_provider: 'GROQ'
          ai_provider_model: 'llama-3.1-70b-versatile'
          codebase_high_overview_descripton:
            'This repository is an LLM Code Reviewer Github Action that use
            typescript implemented with functional programming.'
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GOOGLE_GEMINI_API_KEY: <your gemini api key>
          GROQ_API_KEY: <your groq api key>
          TAVILY_API_KEY: <your tavily api key>
```

## Support My Work

<div align="center">
  <a href="https://buymeacoffee.com/ghackdev" target="_blank">
    <img src="https://github.com/galihlprakoso/logseq-plugin-assistseq-ai-assistant/raw/master/images/buymeacoffee.png" width="200" />
  </a>
</div>

## License

This project is licensed under the
<a href="https://github.com/galihlprakoso/ai-code-reviewer-action/blob/main/LICENSE">MIT
License</a>.

## Template

- https://github.com/actions/typescript-action
