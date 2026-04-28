
import { chatbotService } from './packages/server/api/src/app/chatbot/chatbot.service.ts'
import { FastifyBaseLogger } from 'fastify'

const mockLog = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log
} as unknown as FastifyBaseLogger

async function test() {
    try {
        const result = await chatbotService.chat({
            message: "Invia una mail a test@test.com",
            history: [],
            log: mockLog
        })
        console.log("RESULT:", JSON.stringify(result, null, 2))
    } catch (e) {
        console.error("TEST FAILED:", e)
    }
}

test()
