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
            const mapInputProps = (items: Record<string, any>) => {
                const result: Record<string, { required: string[], optional: string[] }> = {}
                for (const [key, item] of Object.entries(items)) {
                    const entries = Object.entries(item.props || {})
                    result[key] = {
                        required: entries.filter(([_, prop]: [string, any]) => (prop as any).required).map(([k]) => k),
                        optional: entries.filter(([_, prop]: [string, any]) => !(prop as any).required).map(([k]) => k),
                    }
                }
                return result
            }

            const mapOutputFields = (items: Record<string, any>) => {
                const result: Record<string, string[]> = {}
                for (const [key, item] of Object.entries(items)) {
                    const sample = (item as any).sampleData
                    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
                        result[key] = Object.keys(sample)
                    }
                }
                return result
            }

            return {
                name: p!.name,
                actions: mapInputProps(p!.actions),
                triggers: mapInputProps(p!.triggers),
                outputs: mapOutputFields(p!.actions),
            }
        })

        log.info(`Chatbot identified ${simplifiedPieces.length} relevant pieces for the prompt`)

        const messages: any[] = [
            {
                role: 'system',
                content: `You are an expert Activepieces workflow architect. Your job is to design and generate correct, complete, production-ready workflow JSON.

══════════════════════════════════════════════
CRITICAL GOAL: NO UNNECESSARY QUESTIONS
══════════════════════════════════════════════
- You MUST distinguish between STATIC DATA (emails, names) and DYNAMIC DATA (IDs, generated values).
- NEVER ask the user for IDs (spreadsheetId, worksheetId, folderId, item_id) if a previous step generates them.
- Use the {{STEP_NAME.FIELD}} syntax to map outputs automatically.
- If you see a piece that requires an ID (like Google Sheets), check if you can add a 'Create' or 'List' step before it to get that ID dynamically.
- ONLY ask questions for truly missing personal information (e.g., 'What is the recipient email?').

══════════════════════════════════════════════
STRICT STRUCTURAL RULES
══════════════════════════════════════════════
- Step types: EMPTY (trigger only), PIECE_TRIGGER, PIECE, LOOP_ON_ITEMS. No others.
- Every step/trigger MUST have "valid": true.
- Gmail fields (receiver, cc, etc.) MUST be arrays: ["email@example.com"].
- Google Sheets 'insert_row' values MUST be an object: {"Column Name": "Value"}.
- nextAction MUST be nested inside the step, NEVER at the JSON root.
- Loop variables: ALWAYS {{LOOP_NAME.item.field}}. (No 'steps.' prefix, no '.output' in the middle)
- Trigger variables: ALWAYS {{trigger.FIELD}}. (No 'steps.' prefix, no '.output' in the middle)
- Action variables: ALWAYS {{STEP_NAME.FIELD}}. (No 'steps.' prefix, no '.output' in the middle)
- JSON values: Ensure all field values are valid JSON types.
- Array fields: piece input fields that expect a list of items (like Gmail receivers) MUST be an array: ["email@example.com"].
- Object fields: piece input fields that expect key-value pairs (like Google Sheets values) MUST be an object: {"Col": "Val"}.

AVAILABLE PIECES:
${JSON.stringify(simplifiedPieces)}

══════════════════════════════════════════════
EXAMPLE 1 — Simple: Send email (EMPTY trigger)
══════════════════════════════════════════════
\`\`\`json
{
  "displayName": "Invia Email",
  "trigger": {
    "name": "trigger",
    "type": "EMPTY",
    "valid": true,
    "displayName": "Trigger",
    "settings": { "propertySettings": {} },
    "nextAction": {
      "name": "invia_email",
      "type": "PIECE",
      "valid": true,
      "displayName": "Invia Email",
      "settings": {
        "pieceName": "@activepieces/piece-gmail",
        "pieceVersion": "0.0.1",
        "actionName": "send_email",
        "input": {
          "subject": "Ciao!",
          "receiver": ["email@example.com"],
          "body": "Testo della mail."
        },
        "propertySettings": {}
      }
    }
  }
}
\`\`\`

══════════════════════════════════════════════
EXAMPLE 2 — Complex: Create a new Google Sheet, fetch 10 seismic events, insert each as a row via LOOP
══════════════════════════════════════════════
Planning (ZERO USER INTERACTION REQUIRED - ALL IDs ARE DYNAMIC):
  Step 1: Create a new spreadsheet → output.spreadsheetId is available
  Step 2: Create a worksheet inside it → output.worksheetId is available
  Step 3: Fetch list of earthquakes → output is an array
  Step 4: LOOP over each earthquake (LOOP_ON_ITEMS)
  Step 5: Inside loop → insert one row. Use {{xxx.field}} for IDs.

KEY RULE: spreadsheetId and worksheetId come from previous steps. Use {{crea_foglio.spreadsheetId}} and {{crea_worksheet.worksheetId}}.

\`\`\`json
{
  "displayName": "Terremoti su Google Sheets",
  "trigger": {
    "name": "trigger",
    "type": "EMPTY",
    "valid": true,
    "settings": {},
    "nextAction": {
      "name": "crea_foglio",
      "type": "PIECE",
      "valid": true,
      "settings": {
        "pieceName": "@activepieces/piece-google-sheets",
        "actionName": "create-spreadsheet",
        "input": { "title": "Terremoti" }
      },
      "nextAction": {
        "name": "loop_terremoti",
        "type": "LOOP_ON_ITEMS",
        "valid": true,
        "settings": { "items": "{{fetch}}" },
        "firstLoopAction": {
          "name": "insert",
          "type": "PIECE",
          "valid": true,
          "settings": {
            "pieceName": "@activepieces/piece-google-sheets",
            "actionName": "insert_row",
            "input": {
              "spreadsheetId": "{{crea_foglio.spreadsheetId}}",
              "values": { "Mag": "{{loop_terremoti.item.mag}}" }
            }
          }
        }
      }
    }
  }
}
\`\`\`

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
                { headers, timeout: 300000 },
            )
        }

        try {
            let response
            try {
                log.info({ provider, model }, 'Attempting to call primary LLM provider')
                response = await callLlm(provider, model)
            }
            catch (error: any) {
                const groqError = error?.response?.data || error.message
                log.error({ error: groqError }, 'Groq API failed')
                
                if (provider === 'groq') {
                    const fallbackModel = process.env.CHATBOT_MODEL || 'gemma4:e4b'
                    log.warn({ fallbackModel }, 'Falling back to Ollama...')
                    response = await callLlm('ollama', fallbackModel)
                }
                else {
                    throw error
                }
            }

            let reply = response.data.choices[0].message.content
            let flowJson = null

            // Helper to clean "dirty" JSON from LLMs
            const cleanDirtyJson = (str: string) => {
                let cleaned = str
                    .replace(/\/\/.*$/gm, '')         // Remove single-line comments
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                    .replace(/,(\s*[}\]])/g, '$1')    // Remove trailing commas
                    .trim()

                // Auto-close unclosed braces/brackets — LLMs often truncate long JSON
                let braces = 0
                let brackets = 0
                let inString = false
                let escape = false
                for (const ch of cleaned) {
                    if (escape) {
                        escape = false; continue 
                    }
                    if (ch === '\\') {
                        escape = true; continue 
                    }
                    if (ch === '"') {
                        inString = !inString; continue 
                    }
                    if (inString) continue
                    if (ch === '{') braces++
                    else if (ch === '}') braces--
                    else if (ch === '[') brackets++
                    else if (ch === ']') brackets--
                }
                cleaned += ']'.repeat(Math.max(0, brackets))
                cleaned += '}'.repeat(Math.max(0, braces))

                return cleaned
            }

            // 1. Try to extract from markdown blocks (more flexible regex)
            const markdownMatches = [...reply.matchAll(/```(?:json|JSON|)?\s*(\{[\s\S]*?\})\s*```/gi)]
            for (const match of markdownMatches) {
                try {
                    const candidate = JSON.parse(cleanDirtyJson(match[1]))
                    if (candidate.trigger || candidate.flows) {
                        flowJson = candidate
                        reply = reply.replace(match[0], '').trim()
                        break
                    }
                }
                catch (e) {
                    log.error(`Failed to parse markdown JSON: ${e}`)
                }
            }

            // 2. Fallback: search for the widest possible JSON-like structure
            if (!flowJson) {
                const firstBrace = reply.indexOf('{')
                const lastBrace = reply.lastIndexOf('}')
                
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    const candidateStr = reply.substring(firstBrace, lastBrace + 1)
                    try {
                        const candidate = JSON.parse(cleanDirtyJson(candidateStr))
                        if (candidate.trigger || candidate.flows) {
                            flowJson = candidate
                            reply = (reply.substring(0, firstBrace) + reply.substring(lastBrace + 1)).trim()
                        }
                    }
                    catch (e) {
                        log.error(`Failed to parse widest-range JSON: ${e}`)
                    }
                }
            }

            if (!reply || reply.length < 5) {
                reply = 'I\'ve generated the workflow for you! Click the button below to apply it.'
            }

            // Normalize structure: LLMs often put nextAction at root level instead of inside trigger.
            // Move it into trigger.nextAction where Activepieces expects it.
            if (flowJson && flowJson.trigger && flowJson.nextAction && !flowJson.trigger.nextAction) {
                log.info('[ChatbotService] Migrating root-level nextAction into trigger.nextAction')
                flowJson.trigger.nextAction = flowJson.nextAction
                delete flowJson.nextAction
            }

            // Auto-fix piece versions to prevent 400/404 errors due to LLM hallucinations
            if (flowJson && flowJson.trigger) {
                const fixVersions = (step: any, parent?: any, key?: string) => {
                    if (isNil(step)) return
                    
                    // Recursive helper to fix hallucinated mappings like {{steps.xxx.output.field}} -> {{steps.xxx.field}}
                    const fixMappings = (obj: any): any => {
                        if (isNil(obj)) return obj
                        if (typeof obj === 'string') {
                            // Fix hallucinated mappings: {{steps.xxx.output.field}} or {{steps.xxx.field}} -> {{xxx.field}}
                            return obj.replace(/\{\{\s*(?:steps\.)?([\w_]+)(?:\.output)?\.([\w_.]+)\s*\}\}/g, '{{$1.$2}}')
                        }
                        if (Array.isArray(obj)) {
                            return obj.map(item => fixMappings(item))
                        }
                        if (typeof obj === 'object') {
                            const newObj: any = {}
                            for (const k in obj) {
                                newObj[k] = fixMappings(obj[k])
                            }
                            return newObj
                        }
                        return obj
                    }

                    // Apply mapping fix to the entire step object early
                    const fixedStep = fixMappings(step)
                    Object.assign(step, fixedStep)

                    // Remove steps whose type is not a valid Activepieces action type.
                    const validActionTypes = ['PIECE', 'PIECE_TRIGGER', 'LOOP_ON_ITEMS', 'BRANCH', 'EMPTY']
                    if (!validActionTypes.includes(step.type)) {
                        if (parent && key) {
                            log.warn({ stepName: step.name, type: step.type }, '[ChatbotService#fixVersions] Removing step with invalid type')
                            delete parent[key]
                        }
                        return
                    }

                    // 1. Common initialization for ALL steps
                    if (isNil(step.settings)) step.settings = {}
                    step.valid = true
                    if (isNil(step.displayName)) {
                        step.displayName = step.name.split('_').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
                    }

                    // 2. Type-specific logic
                    if (step.type === 'EMPTY') {
                        step.settings = {}
                    }

                    if (step.type === 'LOOP_ON_ITEMS') {
                        // AI MISTAKE: sometimes puts firstLoopAction inside settings. Move it out.
                        if (step.settings?.firstLoopAction) {
                            log.info({ stepName: step.name }, '[ChatbotService#fixVersions] Moving firstLoopAction out of settings')
                            step.firstLoopAction = step.settings.firstLoopAction
                            delete step.settings.firstLoopAction
                        }
                        // LOOP_ON_ITEMS must strictly only have "items" in settings and it MUST be a string (expression)
                        let items = step.settings.items
                        if (Array.isArray(items)) {
                            items = `{{ ${JSON.stringify(items)} }}`
                        }
                        step.settings = { items: items || '' }
                    }

                    if (step.type === 'BRANCH') {
                        // AI MISTAKE: sometimes puts onTrueNextAction/onFalseNextAction inside settings. Move them out.
                        if (step.settings?.onTrueNextAction) {
                            step.onTrueNextAction = step.settings.onTrueNextAction
                            delete step.settings.onTrueNextAction
                        }
                        if (step.settings?.onFalseNextAction) {
                            step.onFalseNextAction = step.settings.onFalseNextAction
                            delete step.settings.onFalseNextAction
                        }
                        // BRANCH must have conditions in settings
                        if (isNil(step.settings.conditions)) {
                            step.settings.conditions = [[{ operator: 'EXISTS', firstValue: '', secondValue: '' }]]
                        }
                    }

                    const isPieceStep = step.type === 'PIECE' || step.type === 'PIECE_TRIGGER'
                    if (isPieceStep) {
                        // Ensure input and propertySettings exist for pieces
                        if (isNil(step.settings.input)) step.settings.input = {}
                        if (isNil(step.settings.propertySettings)) step.settings.propertySettings = {}

                        // Ensure pieceVersion is NEVER undefined to prevent frontend crash
                        step.settings.pieceVersion = step.settings.pieceVersion || '0.0.1'
                        
                        const pieceName = step.settings.pieceName
                        if (pieceName) {
                            const normalizedName = pieceName.replace('@activepieces/piece-', '')
                            const actualPiece = piecesSummary.find(p => 
                                p.name === pieceName || 
                                p.name === `@activepieces/piece-${normalizedName}` ||
                                p.name.replace('@activepieces/piece-', '') === normalizedName,
                            )
                            if (actualPiece) {
                                log.info({ pieceName, actualName: actualPiece.name }, '[ChatbotService#fixVersions] Piece found')
                                step.settings.pieceName = actualPiece.name
                                step.settings.pieceVersion = actualPiece.version
                                
                                // Auto-fix for Gmail piece: convert email strings to arrays if necessary
                                const isGmail = actualPiece.name === '@activepieces/piece-gmail' || actualPiece.name === 'gmail'
                                if (isGmail) {
                                    const arrayFields = ['receiver', 'cc', 'bcc', 'reply_to']
                                    arrayFields.forEach((field) => {
                                        const value = step.settings.input[field]
                                        if (value && typeof value === 'string') {
                                            log.info({ field, value }, '[ChatbotService#fixVersions] Coercing Gmail field to array')
                                            let cleaned = value
                                            if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
                                                cleaned = cleaned.substring(1, cleaned.length - 1).replace(/['"]/g, '').trim()
                                            }
                                            step.settings.input[field] = cleaned.includes('{{') ? [cleaned] : cleaned.split(',').map((e: string) => e.trim()).filter((e: string) => e.length > 0)
                                        }
                                    })
                                }
                                // Auto-fix for Google Sheets insert_row: values must be an object, not array
                                const isSheets = actualPiece.name === '@activepieces/piece-google-sheets'
                                if (isSheets && step.settings.actionName === 'insert_row' && Array.isArray(step.settings.input?.values)) {
                                    const headers: string[] = Array.isArray(step.settings.input.first_row_headers) ? step.settings.input.first_row_headers : []
                                    const valuesObj: Record<string, string> = {}
                                    ;(step.settings.input.values as string[]).forEach((v: string, i: number) => {
                                        valuesObj[headers[i] || `Column${i + 1}`] = v
                                    })
                                    log.info('[ChatbotService#fixVersions] Converted insert_row values from array to object')
                                    step.settings.input.values = valuesObj
                                }
                            }
                            else {
                                step.settings.pieceVersion = step.settings.pieceVersion || '0.0.1'
                            }
                        }
                        else {
                            step.settings.pieceVersion = step.settings.pieceVersion || '0.0.1'
                        }
                    }

                    // 3. Recursive processing of child actions
                    if (step.firstLoopAction) {
                        fixVersions(step.firstLoopAction, step, 'firstLoopAction')
                    }
                    if (step.onTrueNextAction) {
                        fixVersions(step.onTrueNextAction, step, 'onTrueNextAction')
                    }
                    if (step.onFalseNextAction) {
                        fixVersions(step.onFalseNextAction, step, 'onFalseNextAction')
                    }
                    if (step.nextAction) {
                        fixVersions(step.nextAction, step, 'nextAction')
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
                    type: 'EMPTY',
                    displayName: 'Manual Trigger',
                    settings: {},
                    valid: true,
                    nextAction: {
                        name: 'step_1',
                        type: 'PIECE',
                        displayName: firstPiece?.displayName || 'First Step',
                        settings: {
                            pieceName: firstPiece?.name || 'google-sheets',
                            pieceVersion: firstPiece?.version || '0.0.1',
                            actionName: triggerName,
                            input: {},
                        },
                    },
                },
            }

            return {
                reply: `I'm sorry, I encountered an error while generating the workflow: ${errorMessage}. Here is a basic template to get you started.`,
                flowJson: fallbackFlow,
            }
        }
    },
}
