import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSimplifiedMetadata, getPieceDetails } from './metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.dev') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// We keep a simple conversation history
let conversationHistory = [];

export async function initChat() {
  if (!process.env.OPENAI_API_KEY) {
      console.error("Missing OPENAI_API_KEY in environment. Please set it.");
      process.exit(1);
  }

  console.log("Loading Activepieces metadata...");
  const piecesSummary = await getSimplifiedMetadata();
  const summaryText = piecesSummary.map(p => `- ${p.name} (${p.displayName}): ${p.description}`).join('\n');

  conversationHistory.push({
    role: 'system',
    content: `You are an Activepieces Workflow Architect. Your goal is to help users build a workflow JSON.
Here is the list of available pieces:
${summaryText}

When a user asks to build a flow:
1. Identify which pieces (trigger and actions) they need.
2. Tell the user which pieces you selected.
3. If you don't know the exact properties for a piece, output a special function call or ask the user to wait while you fetch the details. 
Actually, to keep this simple: if the user asks for a piece, tell them you need its details.

Wait, instead of function calling, you will act as a conversational agent. 
If the user's flow is fully specified (all field values are known), output the final JSON wrapped in \`\`\`json blocks matching the Activepieces Flow Schema.
If any fields are missing, ASK the user for them. Do NOT guess.

Activepieces Flow Schema:
{
  "displayName": "Name of Flow",
  "trigger": { "name": "trigger", "type": "PIECE", "settings": { "pieceName": "...", "triggerName": "...", "input": { ... } } },
  "actions": [ { "name": "step_1", "type": "PIECE", "settings": { "pieceName": "...", "actionName": "...", "input": { ... } } } ]
}
`
  });
}

export async function handleUserInput(userInput) {
  conversationHistory.push({ role: 'user', content: userInput });

  // Check if user is asking for piece details implicitly
  // In a more robust implementation, we would use OpenAI function calling to let the LLM fetch piece details.
  // For this prototype, we just pass the input to the LLM.

  const response = await openai.chat.completions.create({
    model: 'gpt-4o', // or gpt-4-turbo
    messages: conversationHistory,
  });

  const reply = response.choices[0].message.content;
  conversationHistory.push({ role: 'assistant', content: reply });

  // Try to parse out JSON if it generated a flow
  const jsonMatch = reply.match(/```json\n([\s\S]*?)\n```/);
  let flowJson = null;
  if (jsonMatch) {
    try {
      flowJson = JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error("Failed to parse the flow JSON from the LLM.");
    }
  }

  return { reply, flowJson };
}
