<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

# Node.js Voice Pipeline Agent

<p>
  <a href="https://cloud.livekit.io/projects/p_/sandbox"><strong>Deploy a sandbox app</strong></a>
  •
  <a href="https://docs.livekit.io/agents/overview/">LiveKit Agents Docs</a>
  •
  <a href="https://livekit.io/cloud">LiveKit Cloud</a>
  •
  <a href="https://blog.livekit.io/">Blog</a>
</p>

A basic example of a voice pipeline agent using LiveKit and the Node.js [Agents Framework](https://github.com/livekit/agents-js).

## Dev Setup

Clone the repository and install dependencies:

```bash
npm install
```

Set up the environment by copying `.env.example` to `.env.local` and filling in the required values:

## Required Environment Variables
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_API_KEY`
- `DEEPGRAM_API_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

## Optional Environment Variables
- `OPENAI_MODEL` (default: gpt-4o-mini)
- `DEEPGRAM_MODEL` (default: nova-2-phonecall)
- `DEEPGRAM_ENDPOINTING` (default: 25)
- `CARTESIA_VOICE_ID` (default: 78ab82d5-25be-4f7d-82b3-7ad64e5b85b2)
- `ELEVEN_API_KEY` (for ElevenLabs TTS)
- `LANGFUSE_BASE_URL` (default: https://cloud.langfuse.com)

## Agent Behavior Configuration
- `AGENT_ALLOW_INTERRUPTIONS` (default: true)
- `AGENT_INTERRUPT_SPEECH_DURATION` (default: 500)
- `AGENT_INTERRUPT_MIN_WORDS` (default: 0)
- `AGENT_PREEMPTIVE_SYNTHESIS` (default: false)
- `AGENT_MIN_ENDPOINTING_DELAY` (default: 650)

## VAD Configuration
- `VAD_MIN_SPEECH_DURATION` (default: 0.1)
- `VAD_MIN_SILENCE_DURATION` (default: 0.5)

You can also do this automatically using the LiveKit CLI:

## Deploying to Railway

You can deploy either with the provided Dockerfile or the default Nixpacks flow.

- Dockerfile (recommended):
  - Create a new Railway service from this repo and select Dockerfile.
  - Set env vars from `env.example` in Railway (no real secrets in the repo).
  - Exposes port `8081`.

- Nixpacks (buildpack) without Dockerfile:
  - Railway will detect Node and run `npm start`.
  - We added `prestart` to auto-build before start.
  - Ensure `PORT` is set (Railway provides it; our server respects `process.env.PORT`).

Health check: use `/health` on the service URL.

```bash
lk app env
```

To run the agent, first build the TypeScript project, then execute the output with the `dev` or `start` commands:
    
```bash
npm run build
npm start 
```

This agent requires a frontend application to communicate with. You can use one of our example frontends in [livekit-examples](https://github.com/livekit-examples/), create your own following one of our [client quickstarts](https://docs.livekit.io/realtime/quickstarts/), or test instantly against one of our hosted [Sandbox](https://cloud.livekit.io/projects/p_/sandbox) frontends.

## Configuration Logging

When the agent starts, it will log the current configuration values to help with debugging and verification. You can see these values in the console output when the agent initializes.

## Langfuse Integration

This agent uses Langfuse for prompt management. To use Langfuse:

1. Create a Langfuse account at [langfuse.com](https://langfuse.com)
2. Create a project and get your API keys
3. Create prompts with the names:
   - `candidatePrompt-livekit` for candidate interviews
   - `hiringManagerPrompt-livekit` for hiring manager conversations
4. Set the environment variables in your `.env.local` file
5. The agent will automatically fall back to hardcoded prompts if Langfuse is unavailable
