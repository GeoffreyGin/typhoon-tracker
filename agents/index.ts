export async function onRequest(context: any) {
  const message = context?.request?.body?.message || 'hello';
  context.store.appendMessage({
    conversationId: context.conversation_id,
    role: 'user',
    content: String(message),
  }).catch((e: unknown) => {
    console.error('[agent] failed to append user message:', e);
  });
  const history = await context.store.getMessages({
    conversationId: context.conversation_id,
    limit: 20,
  });
  return {
    ok: true,
    framework: 'basic',
    conversation_id: context.conversation_id,
    run_id: context.run_id,
    message_count: history.length,
    output: `agent:${message}`,
  };
}
