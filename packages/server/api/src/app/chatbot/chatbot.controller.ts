import { PrincipalType } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { chatbotService } from './chatbot.service'

export const chatbotModule: FastifyPluginAsyncZod = async (app) => {
    app.post(
        '/',
        {
            schema: {
                body: z.object({
                    message: z.string(),
                    history: z.array(z.object({
                        role: z.string(),
                        content: z.string(),
                    })),
                }),
            },
            config: {
                security: securityAccess.unscoped([PrincipalType.USER]),
            },
        },
        async (request) => {
            const { message, history } = request.body
            const response = await chatbotService.chat({ message, history, log: request.log })
            return response
        },
    )
}
