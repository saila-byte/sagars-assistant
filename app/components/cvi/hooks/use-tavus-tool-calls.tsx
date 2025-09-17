'use client';

import { useCallback } from 'react';
import { useObservableEvent, useSendAppMessage } from './cvi-events-hooks';

// Tool call types based on your existing implementation
export type ToolCallMsg = {
  type: string;
  tool_call_id: string;
  tool: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type ToolResult = {
  ok: boolean;
  start_time?: string;
  htmlLink?: string;
  hangoutLink?: string;
  error?: string;
  originalEvent?: any;
  newEvent?: any;
};

export const useTavusToolCalls = (
  onToolCall: (toolCall: ToolCallMsg, conversationId: string) => void
) => {
  const sendAppMessage = useSendAppMessage();

  // Listen for tool calls from Tavus
  useObservableEvent<ToolCallMsg>(
    useCallback((event) => {
      
      // Handle tool call events
      if (event.message_type === 'conversation' && event.event_type === 'conversation.tool_call') {
        console.log('🔧 [TOOL_CALL] ===== APP MESSAGE RECEIVED =====', event);
        const toolCall = event.properties;
        if (toolCall && event.conversation_id) {
          onToolCall(toolCall, event.conversation_id);
        }
      }
    }, [onToolCall])
  );

  // Send tool result back to Tavus
  const sendToolResult = useCallback((
    conversationId: string,
    toolCallId: string,
    result: ToolResult
  ) => {
    console.log('🔧 [TOOL_CALL] Sending tool result:', { conversationId, toolCallId, result });
    
    // Send the tool result as an app message
    sendAppMessage({
      message_type: 'conversation',
      event_type: 'conversation.respond',
      conversation_id: conversationId,
      properties: {
        text: JSON.stringify({
          tool_call_id: toolCallId,
          result: result
        })
      }
    });
  }, [sendAppMessage]);

  // Send context updates to Tavus
  const updateContext = useCallback((
    conversationId: string,
    context: string,
    append: boolean = false
  ) => {
    console.log('🔧 [CONTEXT] Updating context:', { conversationId, context, append });
    
    sendAppMessage({
      message_type: 'conversation',
      event_type: append ? 'conversation.append_llm_context' : 'conversation.overwrite_llm_context',
      conversation_id: conversationId,
      properties: {
        context: context
      }
    });
  }, [sendAppMessage]);

  // Interrupt the replica
  const interruptReplica = useCallback((conversationId: string) => {
    console.log('🔧 [INTERRUPT] Interrupting replica:', conversationId);
    
    sendAppMessage({
      message_type: 'conversation',
      event_type: 'conversation.interrupt',
      conversation_id: conversationId
    });
  }, [sendAppMessage]);

  // Send echo message
  const sendEcho = useCallback((
    conversationId: string,
    text: string,
    modality: 'audio' | 'text' = 'text'
  ) => {
    console.log('🔊 [ECHO] Sending echo message:', { conversationId, text, modality });
    
    sendAppMessage({
      message_type: 'conversation',
      event_type: 'conversation.echo',
      conversation_id: conversationId,
      properties: {
        modality: modality,
        text: text
      }
    });
  }, [sendAppMessage]);

  // End conversation
  const endConversation = useCallback(async (conversationId: string) => {
    console.log('🔚 [END] Ending conversation:', conversationId);
    
    try {
      const response = await fetch(`https://tavusapi.com/v2/conversations/${conversationId}/end`, {
        method: 'POST',
        headers: {
          'x-api-key': process.env.TAVUS_API_KEY || '',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to end conversation: ${response.statusText}`);
      }

      console.log('🔚 [END] Conversation ended successfully');
    } catch (error) {
      console.error('🔚 [END] Error ending conversation:', error);
    }
  }, []);

  return {
    sendToolResult,
    updateContext,
    interruptReplica,
    sendEcho,
    endConversation
  };
};
