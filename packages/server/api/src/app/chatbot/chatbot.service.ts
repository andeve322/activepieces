import { safeHttp } from '@activepieces/server-utils'
import { isNil } from '@activepieces/shared'
import axios from 'axios'
import { FastifyBaseLogger } from 'fastify'
import { pieceMetadataService } from '../pieces/metadata/piece-metadata-service'

export const chatbotService = {
    async chat({ message, history, log }: { message: string, history: any[], log: FastifyBaseLogger }) {
        const groqApiKey = process.env.GROQ_API_KEY
        if (isNil(groqApiKey)) {
            throw new Error('GROQ_API_KEY is not configured in the environment')
        }

        // Fetch piece list
        const piecesSummary = await pieceMetadataService(log).list({
            includeHidden: false,
        })

        // Optimized: Fetch only the most relevant pieces or a smaller subset to avoid timeouts
        const relevantPieceNames = ['schedule', 'gmail', 'smtp', 'ingv', 'weather', 'http', 'discord', 'slack', 'google-sheets', 'google-calendar', 'store']
        const fullPieces = await Promise.all(
            piecesSummary
                .filter(p => relevantPieceNames.includes(p.name.replace('@activepieces/piece-', '')) || relevantPieceNames.includes(p.name))
                .slice(0, 20)
                .map(async (p) => {
                    try {
                        return await pieceMetadataService(log).get({ name: p.name, version: p.version })
                    }
                    catch (e) {
                        log.error(`Failed to fetch metadata for piece ${p.name}: ${e}`)
                        return undefined
                    }
                }),
        )

        const simplifiedPieces = fullPieces.filter(p => !isNil(p)).map(p => {
            const mapProps = (items: Record<string, any>) => {
                const result: Record<string, string[]> = {}
                for (const [key, item] of Object.entries(items)) {
                    const requiredProps = Object.entries(item.props || {})
                        .filter(([_, prop]: [string, any]) => prop.required)
                        .map(([propKey, _]) => propKey)
                    result[key] = requiredProps
                }
                return result
            }

            return {
                name: p!.name,
                displayName: p!.displayName,
                version: p!.version,
                triggers: mapProps(p!.triggers),
                actions: mapProps(p!.actions),
            }
        })

        log.info(`Chatbot identified ${simplifiedPieces.length} relevant pieces for the prompt`)

        const messages = [
            {
                role: 'system',
                content: `You are an Activepieces AI assistant. Generate valid workflow JSON based on user requests.

AVAILABLE PIECES:
${JSON.stringify(simplifiedPieces)}

JSON EXAMPLE:
{
  "displayName": "Terremoti giornalieri",
  "trigger": {
    "name": "trigger",
    "type": "PIECE_TRIGGER",
    "settings": {
      "pieceName": "@activepieces/piece-schedule",
      "pieceVersion": "0.2.1",
      "triggerName": "cron_expression",
      "input": { "cron": "0 7 * * *" }
    },
    "nextAction": {
      "name": "recupero_terremoti",
      "type": "PIECE",
      "settings": {
        "pieceName": "@activepieces/piece-ingv",
        "pieceVersion": "0.0.1",
        "actionName": "get_recent_earthquakes",
        "input": {}
      },
      "nextAction": {
        "name": "invio_mail",
        "type": "PIECE",
        "settings": {
          "pieceName": "@activepieces/piece-gmail",
          "pieceVersion": "0.12.2",
          "actionName": "send_email",
          "input": {
            "subject": "Terremoti del giorno prima",
            "receiver": ["tua_email@example.com"],
            "body": "Ecco la lista dei terremoti: {{steps.recupero_terremoti}}"
          }
        }
      }
    }
  }
}

EXAMPLE — Send email manually (EMPTY trigger + Gmail):
{
  "displayName": "Invia Email",
  "trigger": {
    "name": "trigger",
    "type": "EMPTY",
    "displayName": "Trigger",
    "settings": { "propertySettings": {} },
    "valid": true,
    "nextAction": {
      "name": "invia_email",
      "type": "PIECE",
      "displayName": "Invia Email",
      "settings": {
        "pieceName": "@activepieces/piece-gmail",
        "pieceVersion": "0.0.1",
        "actionName": "send_email",
        "input": {
          "subject": "Oggetto della mail",
          "receiver": ["email@example.com"],
          "body": "Corpo della mail."
        },
        "propertySettings": {}
      }
    }
  }
}

STRICT RULES:
- If a specific trigger (like Schedule or Webhook) is NOT requested, ALWAYS use an EMPTY trigger (type: EMPTY).
- Never use a PIECE trigger without a valid pieceName and triggerName.
- Every step must have a unique, lowercase name with underscores (e.g., 'send_email', 'format_data').
- Ensure all piece versions are '0.0.1'.
- For the Gmail piece, ALL email fields (receiver, cc, bcc, reply_to) MUST always be arrays of strings: ["email@example.com"]. NEVER use a plain string.
- Use 'PIECE' type for integration steps.
- Only include 'nextAction' for steps that are not the last one.
- Give each step a short, meaningful "name" (lowercase snake_case) based on its function.
- Use {{ steps.step_name.field }} for data mapping.
- If a piece requires specific user data (e.g., an email address), ASK the user before generating the workflow.
- Be interactive: if the user's request is vague, ask clarifying questions.
- Output ONLY the JSON block inside \`\`\`json \`\`\` followed by a short summary.`,
            },
            ...history,
            { role: 'user', content: message },
        ]

        const provider = process.env.CHATBOT_PROVIDER || 'groq'
        const model = process.env.CHATBOT_MODEL || (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'llama3.1:latest')

        const callLlm = async (currentProvider: string, currentModel: string) => {
            const isOllama = currentProvider === 'ollama'
            const baseUrl = isOllama 
                ? 'http://127.0.0.1:11434/v1/chat/completions' 
                : 'https://api.groq.com/openai/v1/chat/completions'

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            }

            if (!isOllama) {
                headers['Authorization'] = `Bearer ${groqApiKey}`
            }

            const client = isOllama ? axios : safeHttp.axios

            return client.post(
                baseUrl,
                {
                    model: currentModel,
                    messages,
                    temperature: 0.3,
                },
                { headers, timeout: 60000 },
            )
        }

        try {
            let response
            try {
                log.info({ provider, model }, 'Attempting to call primary LLM provider')
                response = await callLlm(provider, model)
            }
            catch (error: any) {
                if (provider === 'groq') {
                    log.warn('Groq failed, falling back to Ollama')
                    // Explicitly use llama3.1:latest for Ollama to avoid using the Groq model name from env
                    response = await callLlm('ollama', 'llama3.1:latest')
                }
                else {
                    throw error
                }
            }

            let reply = response.data.choices[0].message.content
            let flowJson = null

            // Helper to clean "dirty" JSON from LLMs
            const cleanDirtyJson = (str: string) => {
                return str
                    .replace(/\/\/.*$/gm, '') // Remove single line comments
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                    .replace(/,(\s*[}\]])/g, '$1') // Remove trailing commas
                    .trim()
            }

            // 1. Try to extract from markdown blocks
            const markdownMatches = [...reply.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)]
            for (const match of markdownMatches) {
                try {
                    const candidate = JSON.parse(cleanDirtyJson(match[1]))
                    if (candidate.trigger) {
                        flowJson = candidate
                        reply = reply.replace(match[0], '').trim()
                        break
                    }
                }
                catch (e) {
                    log.error(`Failed to parse markdown JSON: ${e}`)
                }
            }

            // 2. Fallback: search for any balanced JSON-like structure containing "trigger"
            if (!flowJson) {
                const potentialJsonMatch = reply.match(/\{[\s\S]*?"trigger"[\s\S]*?\}/)
                if (potentialJsonMatch) {
                    try {
                        const candidate = JSON.parse(cleanDirtyJson(potentialJsonMatch[0]))
                        flowJson = candidate
                        reply = reply.replace(potentialJsonMatch[0], '').trim()
                    }
                    catch (e) {
                        log.error(`Failed to parse fallback JSON: ${e}`)
                    }
                }
            }

            if (!reply || reply.length < 5) {
                reply = 'I\'ve generated the workflow for you! Click the button below to apply it.'
            }

            // Auto-fix piece versions to prevent 400/404 errors due to LLM hallucinations
            if (flowJson && flowJson.trigger) {
                const fixVersions = (step: any) => {
                    if (!step) return
                    if (step.type === 'PIECE' && step.settings && step.settings.pieceName) {
                        const pieceName = step.settings.pieceName
                        const actualPiece = piecesSummary.find(p => 
                            p.name === pieceName || p.name === `@activepieces/piece-${pieceName}`,
                        )
                        if (actualPiece) {
                            log.info({ pieceName, actualName: actualPiece.name }, '[ChatbotService#fixVersions] Piece found')
                            step.settings.pieceName = actualPiece.name // ensure correct prefix
                            step.settings.pieceVersion = actualPiece.version // force correct version
                            
                            // Ensure input object exists to prevent frontend crashes
                            if (!step.settings.input) {
                                step.settings.input = {}
                            }

                            // Auto-fix for Gmail piece: convert email strings to arrays if necessary
                            const isGmail = actualPiece.name === '@activepieces/piece-gmail' || actualPiece.name === 'gmail'
                            
                            if (isGmail) {
                                const arrayFields = ['receiver', 'cc', 'bcc', 'reply_to']
                                arrayFields.forEach((field) => {
                                    const value = step.settings.input[field]
                                    // Coerce any string value to an array — no exceptions
                                    if (value && typeof value === 'string') {
                                        log.info({ field, value }, '[ChatbotService#fixVersions] Coercing Gmail field to array')
                                        let cleaned = value
                                        // Strip spurious wrapping brackets added by some LLMs: "[email]" → "email"
                                        if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
                                            cleaned = cleaned.substring(1, cleaned.length - 1).replace(/['"]/g, '').trim()
                                        }
                                        // Template expressions ({{ ... }}) must be kept as-is inside an array
                                        if (cleaned.includes('{{')) {
                                            step.settings.input[field] = [cleaned]
                                        }
                                        else {
                                            step.settings.input[field] = cleaned.split(',').map((e: string) => e.trim()).filter((e: string) => e.length > 0)
                                        }
                                    }
                                })
                            }
                        }
                        else {
                            log.warn({ pieceName }, '[ChatbotService#fixVersions] Piece not found, converting to EMPTY')
                            // LLM hallucinated an uninstalled piece. Convert to EMPTY to avoid 400 errors.
                            step.type = 'EMPTY'
                            step.settings = {}
                        }
                    }
                    if (step.nextAction) {
                        fixVersions(step.nextAction)
                    }
                }
                fixVersions(flowJson.trigger)
            }

            return {
                reply,
                flowJson,
            }
        }
        catch (error: any) {
            const errorMessage = error?.response?.data ? JSON.stringify(error.response.data) : error.message
            log.error({ error: errorMessage }, 'All LLM providers failed')
            
            const firstPiece = piecesSummary.length > 0 ? piecesSummary[0] : null
            const triggerName = firstPiece && Object.keys(firstPiece.triggers || {})[0] ? Object.keys(firstPiece.triggers)[0] : 'default_trigger'

            const fallbackFlow = {
                displayName: 'Fallback Flow',
                trigger: {
                    name: 'trigger',
                    type: firstPiece ? 'PIECE' : 'EMPTY',
                    settings: firstPiece ? {
                        pieceName: firstPiece.name,
                        pieceVersion: firstPiece.version,
                        triggerName,
                        input: {},
                    } : {
                        input: {},
                    },
                    nextAction: undefined,
                },
            }
            return { reply: 'Both Groq and Ollama failed. Please check your local Ollama instance.', flowJson: fallbackFlow }
        }
    },
}
