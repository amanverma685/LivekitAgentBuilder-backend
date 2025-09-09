// SPDX-FileCopyrightText: 2024 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0
import {
  AutoSubscribe,
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  pipeline,
} from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrompt } from './promptManager.js';
// Noise cancellation depends on onnxruntime native binaries which may not be
// available in minimal containers. We will load it dynamically only if enabled.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load env from project root: first .env, then .env.local to allow local overrides
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Validate required env vars for agent
function requireEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Create a .env file (you can copy from .env.example) and set these values.');
    process.exit(1);
  }
}

requireEnv([
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'OPENAI_API_KEY',
  'DEEPGRAM_API_KEY',
]);

// Configuration validation and logging (silent by default)
const logConfiguration = () => {
  if (String(process.env.DEBUG_AGENT_LOGS || '').toLowerCase() !== 'true') return;
  console.log('Agent Configuration:');
  console.log('- OpenAI Model:', process.env.OPENAI_MODEL || 'gpt-4o-mini');
  console.log('- Deepgram Model:', process.env.DEEPGRAM_MODEL || 'nova-2-phonecall');
  console.log('- Deepgram Endpointing:', process.env.DEEPGRAM_ENDPOINTING || '25');
  console.log('- Cartesia Voice ID:', process.env.CARTESIA_VOICE_ID || '78ab82d5-25be-4f7d-82b3-7ad64e5b85b2');
  console.log('- Allow Interruptions:', process.env.AGENT_ALLOW_INTERRUPTIONS || 'true');
  console.log('- Interrupt Speech Duration:', process.env.AGENT_INTERRUPT_SPEECH_DURATION || '500');
  console.log('- Min Endpointing Delay:', process.env.AGENT_MIN_ENDPOINTING_DELAY || '650');
  console.log('- VAD Min Speech Duration:', process.env.VAD_MIN_SPEECH_DURATION || '0.1');
  console.log('- VAD Min Silence Duration:', process.env.VAD_MIN_SILENCE_DURATION || '0.5');
  console.log('- VAD Prefix Padding Duration:', process.env.VAD_PREFIX_PADDING_DURATION || '0.5');
  console.log('- VAD Max Buffered Speech:', process.env.VAD_MAX_BUFFERED_SPEECH || '60.0');
  console.log('- VAD Activation Threshold:', process.env.VAD_ACTIVATION_THRESHOLD || '0.5');
  console.log('- VAD Sample Rate:', process.env.VAD_SAMPLE_RATE || '16000');
  console.log('- VAD Force CPU:', process.env.VAD_FORCE_CPU || 'false');
};

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    const desiredSampleRate = parseInt(process.env.VAD_SAMPLE_RATE || '16000');
    const sampleRate = (desiredSampleRate === 8000 ? 8000 : 16000) as 8000 | 16000;
    const vadConfig = {
      minSpeechDuration: parseFloat(process.env.VAD_MIN_SPEECH_DURATION || '0.05'),
      minSilenceDuration: parseFloat(process.env.VAD_MIN_SILENCE_DURATION || '0.55'),
      prefixPaddingDuration: parseFloat(process.env.VAD_PREFIX_PADDING_DURATION || '0.5'),
      maxBufferedSpeech: parseFloat(process.env.VAD_MAX_BUFFERED_SPEECH || '60.0'),
      activationThreshold: parseFloat(process.env.VAD_ACTIVATION_THRESHOLD || '0.5'),
      sampleRate,
      forceCPU: process.env.VAD_FORCE_CPU === 'true',
    };
    proc.userData.vad = await silero.VAD.load(vadConfig);
  },
  entry: async (ctx: JobContext) => {
    // Log current configuration
    logConfiguration();
    
    const vad = ctx.proc.userData.vad! as silero.VAD;
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    if (String(process.env.DEBUG_AGENT_LOGS || '').toLowerCase() === 'true') {
      console.log('waiting for participant');
    }
    const participant = await ctx.waitForParticipant();
    if (String(process.env.DEBUG_AGENT_LOGS || '').toLowerCase() === 'true') {
      console.log(
        `starting assistant example agent for ${participant.identity}, ${JSON.stringify(participant.attributes)}`,
      );
    }

    // Normalize attributes coming from upstream (API) using snake_case only
    const attributes = (participant?.attributes || {}) as any;
    // Always log the raw attributes coming from LiveKit for debugging/traceability
    try {
      console.log('[agent] LiveKit participant attributes:', JSON.stringify(attributes));
    } catch {
      console.log('[agent] LiveKit participant attributes (non-serializable)');
    }
    let prompt_variables: Record<string, unknown> = {};
    if (typeof attributes.prompt_variables === 'string') {
      try { prompt_variables = JSON.parse(attributes.prompt_variables); } catch { prompt_variables = {}; }
    } else if (attributes.prompt_variables && typeof attributes.prompt_variables === 'object') {
      prompt_variables = attributes.prompt_variables as Record<string, unknown>;
    }

    // Build prompt. If prompt_text is provided, it takes priority; otherwise fetch by prompt_name/label
    const prompt = await generatePrompt({
      prompt_name: attributes.prompt_name,
      prompt_label: attributes.prompt_label,
      prompt_text: attributes.prompt_text,
      prompt_variables,
    });

    // Log the compiled prompt text
    console.log('[agent] Compiled prompt:\n' + String(prompt || ''));

    // Optional initial content from metadata; otherwise generic default
    let initial_content = String((prompt_variables as any)?.initial_content || '').trim() ||
      'Hello! I\'m your AI assistant. Let\'s get started.';
    //console.log("final prompt",prompt);
    const initialContext = new llm.ChatContext().append({
      role: llm.ChatRole.SYSTEM,
      text:  prompt
    });

    // Agent configuration from environment variables
    const agentConfig = {
      // initial ChatContext with system prompt
      chatCtx: initialContext,
      turnDetector: new livekit.turnDetector.EOUModel(),
      // whether the agent can be interrupted
      allowInterruptions: true, //process.env.AGENT_ALLOW_INTERRUPTIONS === 'true',
      // sensitivity of when to interrupt
      interruptSpeechDuration: parseInt(process.env.AGENT_INTERRUPT_SPEECH_DURATION || '500'),
      interruptMinWords: parseInt(process.env.AGENT_INTERRUPT_MIN_WORDS || '0'),
      preemptiveSynthesis: false, //process.env.AGENT_PREEMPTIVE_SYNTHESIS === 'false',
      // minimal silence duration to consider end-of-turn
      minEndpointingDelay: parseInt(process.env.AGENT_MIN_ENDPOINTING_DELAY || '650'),
    };
    if (String(process.env.DEBUG_AGENT_LOGS || '').toLowerCase() === 'true') {
      console.log('agentConfig', agentConfig);
    }

    // Optionally enable noise cancellation if the dependency is available
    let noiseCancellation: any = undefined;
    if (String(process.env.ENABLE_NOISE_CANCELLATION || '').toLowerCase() === 'true') {
      try {
        const mod = await import('@livekit/noise-cancellation-node');
        // BackgroundVoiceCancellation returns a transform factory
        noiseCancellation = (mod as any).BackgroundVoiceCancellation?.();
      } catch (err) {
        console.warn('[agent] Noise cancellation not available, continuing without it');
      }
    }

    const agent = new pipeline.VoicePipelineAgent(
      vad,
      new deepgram.STT({
        apiKey: process.env.DEEPGRAM_API_KEY,
        model: (process.env.DEEPGRAM_MODEL || 'nova-2-phonecall') as any,
        endpointing: parseInt(process.env.DEEPGRAM_ENDPOINTING || '25')
      }),
      new openai.LLM({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini' }),
      // new elevenlabs.TTS(),
      new cartesia.TTS({ voice: process.env.CARTESIA_VOICE_ID || '78ab82d5-25be-4f7d-82b3-7ad64e5b85b2' }),
      { ...agentConfig, noiseCancellation },
    );
    agent.start(ctx.room, participant);

    await agent.say(initial_content, true);
  },
});

// Only run the CLI when this file is executed directly, not when imported
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(selfPath)) {
  cli.runApp(new WorkerOptions({ agent: selfPath }));
}

