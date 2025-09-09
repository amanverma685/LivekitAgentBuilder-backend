import { LangfuseClient } from "@langfuse/client";

// Initialize Langfuse client only if env keys are provided
let langfuse = null;
const hasLangfuseCreds =
  Boolean(process.env.LANGFUSE_PUBLIC_KEY) && Boolean(process.env.LANGFUSE_SECRET_KEY);
if (hasLangfuseCreds) {
  try {
    langfuse = new LangfuseClient({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com",
    });
  } catch (e) {
    console.error('[Langfuse] Failed to initialize client, falling back to static prompt:', e);
    langfuse = null;
  }
}

export async function generatePrompt(details) {
  const promptName = details?.prompt_name;
  const label = details?.prompt_label || undefined;
  const promptTextRaw = typeof details?.prompt_text === 'string' ? details.prompt_text : '';

  // Normalize variables from details.prompt_variables (stringified or object)
  let variables = details?.prompt_variables ?? {};
  if (typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch (_e) {
      variables = {};
    }
  }
  if (!variables || typeof variables !== 'object') variables = {};

  if (!promptName) {
    throw new Error('Missing prompt_name in details');
  }

  // Helper: coerce chat or text prompt into a string
  const toStringPrompt = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((m) => (m && typeof m === 'object' ? String(m.content ?? '') : String(m ?? '')))
        .join('\n');
    }
    return String(value ?? '');
  };

  // Helper: manual {{ var }} replacement
  const manualCompile = (template, vars) =>
    toStringPrompt(template).replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
      // Support nested keys like a.b if provided
      const value = key.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), vars);
      return value === undefined || value === null ? '' : String(value);
    });

  // 1) If prompt_text is provided (non-empty), use it directly (highest priority)
  const promptText = String(promptTextRaw || '').trim();
  if (promptText.length > 0) {
    return manualCompile(promptText, variables) || '';
  }

  // 2) Otherwise, fetch from Langfuse using prompt_name (and optional label)
  // If Langfuse is not configured, we will fall back below
  if (!langfuse) {
    const fallback =
      manualCompile(
        "You are a helpful, concise voice assistant. Provide clear, direct answers.",
        variables,
      ) || '';
    console.log('[Langfuse] Not configured. Using fallback prompt.');
    return fallback;
  }

  try {
    // Fetch prompt from Langfuse, try with label then fallback
    let fetched;
    try {
      fetched = label
        ? await langfuse.prompt.get(promptName, { label })
        : await langfuse.prompt.get(promptName);
    } catch (_err) {
      fetched = await langfuse.prompt.get(promptName);
    }
    if (!fetched) throw new Error(`Prompt not found: ${promptName}${label ? ` (label: ${label})` : ''}`);

    // Compile using SDK if available, otherwise manual replacement
    let compiledText;
    if (typeof fetched.compile === 'function') {
      compiledText = fetched.compile(variables);
    } else {
      compiledText = manualCompile(fetched.prompt || '', variables);
    }

    const compiledString = toStringPrompt(compiledText);
    console.log('[Langfuse] Prompt (compiled):\n' + compiledString);
    return compiledString;
  } catch (error) {
    console.error('Error fetching/compiling prompt from Langfuse:', error);
    // Fallback to a safe static prompt if Langfuse request fails (e.g., 401)
    const fallback =
      manualCompile(
        "You are a helpful, concise voice assistant. Provide clear, direct answers.",
        variables,
      ) || '';
    return fallback;
  }
}


