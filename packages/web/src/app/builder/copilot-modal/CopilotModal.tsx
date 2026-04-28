import { FlowOperationType, FlowTriggerType } from '@activepieces/shared';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import {
  Send,
  Sparkles,
  Wand2,
  User,
  Bot,
  Loader2,
  X,
  GripHorizontal,
} from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { authenticationSession } from '@/lib/authentication-session';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  flowJson?: any;
}

interface CopilotModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applyOperation: (operation: any) => void;
}

export const CopilotModal = ({
  open,
  onOpenChange,
  applyOperation,
}: CopilotModalProps) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Ciao! Sono il tuo assistente AI. Come posso aiutarti a costruire il tuo prossimo workflow oggi?',
    },
  ]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  const { mutate: sendMessage, isPending } = useMutation({
    mutationFn: async (message: string) => {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const response = await axios.post(
        '/api/v1/chatbot',
        {
          message,
          history,
        },
        {
          headers: {
            Authorization: `Bearer ${authenticationSession.getToken()}`,
          },
        },
      );
      return response.data;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply,
          flowJson: data.flowJson,
        },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isPending) return;
    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    sendMessage(userMessage);
  };

  const handleApplyFlow = (flowJson: any) => {
    console.log('Applying flowJson:', JSON.stringify(flowJson, null, 2));

    // Normalize: LLMs often put nextAction at root level instead of inside trigger.
    if (flowJson.nextAction && !flowJson.trigger?.nextAction) {
      flowJson.trigger = {
        ...flowJson.trigger,
        nextAction: flowJson.nextAction,
      };
      delete flowJson.nextAction;
    }

    // Sanitize generated JSON for Activepieces
    const sanitizedTrigger = { ...flowJson.trigger };
    if (
      !sanitizedTrigger.type ||
      (sanitizedTrigger.type === 'PIECE' &&
        !sanitizedTrigger.settings?.pieceName)
    ) {
      sanitizedTrigger.type = FlowTriggerType.EMPTY;
      sanitizedTrigger.settings = {};
      sanitizedTrigger.displayName = sanitizedTrigger.displayName || 'Trigger';
      sanitizedTrigger.settings = {};
      sanitizedTrigger.valid = false;
    } else {
      sanitizedTrigger.valid = true;
    }
    sanitizedTrigger.name = 'trigger';

    // Recursive function to ensure unique and meaningful step names and clean up empty nextAction
    const usedNames = new Set<string>();
    const assignNames = (
      step: any,
      index: number,
      parent?: any,
      key?: string,
    ) => {
      if (!step) return;

      // Clean up invalid EMPTY actions at the end of chains (LLM common mistake)
      if (step.type === 'EMPTY' && index > 0 && parent && key) {
        delete parent[key];
        return;
      }

      // Clean up empty nextAction - backend fails if it's an empty object
      if (step.nextAction && Object.keys(step.nextAction).length === 0) {
        delete step.nextAction;
      }

      // Every step must be marked valid for the builder to allow testing and saving
      step.valid = true;

      // Critical fix for "pieceVersion.startsWith is not a function" crash
      if ((step.type === 'PIECE' || step.type === 'PIECE_TRIGGER') && !step.settings?.pieceVersion) {
        if (!step.settings) step.settings = {};
        step.settings.pieceVersion = '0.0.1';
      }

      if (step.settings?.firstLoopAction) {
        step.firstLoopAction = step.settings.firstLoopAction;
        delete step.settings.firstLoopAction;
      }

      if (!step.settings) {
        step.settings = {};
      }

      if (step.type === 'LOOP_ON_ITEMS') {
        step.settings = { items: step.settings.items };
      } else {
        if (!step.settings.input) {
          step.settings.input = {};
        }
        if (!step.settings.propertySettings) {
          step.settings.propertySettings = {};
        }
      }
        // Flatten single-element arrays back to scalars (common AI over-wrapping mistake).
        // Exception: Gmail email fields must stay as arrays — the piece schema requires it.
        const gmailArrayFields = new Set(['receiver', 'cc', 'bcc', 'reply_to']);
        const isGmailStep =
          step.settings.pieceName === '@activepieces/piece-gmail' ||
          step.settings.pieceName === 'gmail';
        for (const key in step.settings.input) {
          if (
            Array.isArray(step.settings.input[key]) &&
            step.settings.input[key].length === 1
          ) {
            if (isGmailStep && gmailArrayFields.has(key)) continue;
            step.settings.input[key] = step.settings.input[key][0];
          }
        }

      let baseName = step.name;

      // Sanitization function
      const slugify = (str: string) => {
        return str
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
      };

      if (index === 0) {
        step.name = 'trigger';
      } else {
        // If name is missing or generic, try to use pieceName or type
        if (!baseName || baseName.match(/^step_?\d*$/)) {
          baseName =
            step.settings?.pieceName?.replace('@activepieces/piece-', '') ||
            step.type?.toLowerCase() ||
            'step';
        }

        let finalName = slugify(baseName);
        let counter = 1;
        while (usedNames.has(finalName)) {
          finalName = `${slugify(baseName)}_${counter}`;
          counter++;
        }
        step.name = finalName;
      }

      usedNames.add(step.name);

      // Fix terminology and problematic versions
      if (step.type === 'PIECE' && step.settings) {
        // Brutal fix for schedule 0.2.1 404 error
        if (
          step.settings.pieceName === 'schedule' ||
          step.settings.pieceName === '@activepieces/piece-schedule'
        ) {
          step.settings.pieceVersion = '~0.1.0';
        }

        if (index === 0) {
          if (step.settings.actionName && !step.settings.triggerName) {
            step.settings.triggerName = step.settings.actionName;
          }
        } else {
          if (step.settings.triggerName && !step.settings.actionName) {
            step.settings.actionName = step.settings.triggerName;
          }
        }

        if (!step.displayName) {
          // Make displayName pretty: "Fetch Data" instead of "fetch_data"
          step.displayName = step.name
            .split('_')
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }
        if (step.settings && !step.settings.propertySettings) {
          step.settings.propertySettings = {};
        }
      }

      if (step.firstLoopAction) {
        assignNames(step.firstLoopAction, index + 1, step, 'firstLoopAction');
      }
      if (step.children) {
        step.children.forEach((child: any, i: number) => {
          if (child) assignNames(child, index + 1, step.children, i.toString());
        });
      }
      if (step.nextAction) {
        assignNames(step.nextAction, index + 1, step, 'nextAction');
      }
    };

    assignNames(sanitizedTrigger, 0);

    applyOperation({
      type: FlowOperationType.IMPORT_FLOW,
      request: {
        displayName: flowJson.displayName || 'Generated Workflow',
        trigger: sanitizedTrigger,
        notes: [],
      },
    });
    onOpenChange(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          className="fixed bottom-10 right-10 w-[400px] h-[600px] z-[50] flex flex-col shadow-2xl rounded-2xl border bg-background/95 backdrop-blur-md overflow-hidden"
        >
          {/* Header & Drag Handle */}
          <div
            onPointerDown={(e) => dragControls.start(e)}
            className="flex items-center justify-between p-4 border-b bg-primary/5 cursor-grab active:cursor-grabbing group"
          >
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-semibold text-sm">Copilot Assistant</span>
            </div>

            <div className="flex items-center gap-1">
              <div className="p-1 rounded transition-colors mr-2">
                <GripHorizontal className="w-4 h-4 text-muted-foreground" />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn('flex flex-col gap-2 max-w-[90%]', {
                    'ml-auto items-end': m.role === 'user',
                    'mr-auto items-start': m.role === 'assistant',
                  })}
                >
                  <div className="flex items-center gap-2">
                    {m.role === 'assistant' ? (
                      <div className="p-1 rounded-full bg-primary/10 text-primary">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="p-1 rounded-full bg-muted text-muted-foreground">
                        <User className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      {m.role === 'assistant' ? 'Copilot' : 'You'}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'rounded-2xl p-3 text-sm border select-text',
                      {
                        'bg-primary text-primary-foreground border-primary/20 rounded-tr-none':
                          m.role === 'user',
                        'bg-muted/50 text-foreground border-border rounded-tl-none shadow-sm':
                          m.role === 'assistant',
                      },
                    )}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkBreaks]}
                      components={{
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0 leading-relaxed">
                            {children}
                          </p>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc ml-4 mb-2 space-y-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal ml-4 mb-2 space-y-1">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => <li>{children}</li>,
                        code: ({ children }) => (
                          <code
                            className={cn(
                              'rounded px-1 py-0.5 font-mono text-[10px]',
                              m.role === 'user'
                                ? 'bg-white/20'
                                : 'bg-primary/10',
                            )}
                          >
                            {children}
                          </code>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-bold">{children}</strong>
                        ),
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                  {(() => {
                    let activeFlowJson = m.flowJson;

                    // Frontend safety net: try to extract JSON if server missed it
                    if (!activeFlowJson && m.role === 'assistant') {
                      // 1. Try markdown first
                      const jsonMatch = m.content.match(
                        /```(?:json|JSON|)?\s*(\{[\s\S]*?\})\s*```/i,
                      );
                      if (jsonMatch) {
                        try {
                          const cleanStr = jsonMatch[1]
                            .replace(/\/\/.*$/gm, '')
                            .replace(/,(\s*[}\]])/g, '$1')
                            .trim();
                          activeFlowJson = JSON.parse(cleanStr);
                        } catch (e) {}
                      }

                      // 2. Try widest range of { ... }
                      if (!activeFlowJson) {
                        const firstBrace = m.content.indexOf('{');
                        const lastBrace = m.content.lastIndexOf('}');
                        if (
                          firstBrace !== -1 &&
                          lastBrace !== -1 &&
                          lastBrace > firstBrace
                        ) {
                          const candidateStr = m.content.substring(
                            firstBrace,
                            lastBrace + 1,
                          );
                          try {
                            const cleanStr = candidateStr
                              .replace(/\/\/.*$/gm, '')
                              .replace(/,(\s*[}\]])/g, '$1')
                              .trim();
                            const candidate = JSON.parse(cleanStr);
                            if (candidate.trigger || candidate.flows) {
                              activeFlowJson = candidate;
                            }
                          } catch (e) {}
                        }
                      }
                    }

                    if (activeFlowJson) {
                      return (
                        <div className="flex gap-2 w-full mt-2">
                          <Button
                            onClick={() => handleApplyFlow(activeFlowJson)}
                            className="flex-1 gap-2 bg-gradient-to-r from-primary to-primary/80 hover:scale-[1.02] transition-transform shadow-md"
                            size="sm"
                          >
                            <Wand2 className="w-4 h-4" />
                            Applica Workflow
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-2"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                JSON.stringify(activeFlowJson, null, 2),
                              );
                            }}
                          >
                            <Send className="w-4 h-4 rotate-90" />
                            Copia
                          </Button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              ))}
              {isPending && (
                <div className="flex flex-col gap-2 mr-auto items-start max-w-[85%]">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-full bg-primary/10 text-primary animate-pulse">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded-2xl rounded-tl-none p-3 border border-border shadow-sm flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">
                      Sto pensando...
                    </span>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div className="p-4 bg-background border-t">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="Descrivi il workflow..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary/50 text-sm"
                disabled={isPending}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || isPending}
                className="shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
            <p className="text-[10px] text-center mt-2 text-muted-foreground uppercase tracking-widest opacity-40">
              Powered by Groq & Ollama
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
