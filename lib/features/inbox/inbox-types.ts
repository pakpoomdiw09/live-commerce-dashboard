export type InboxMember = { id: string; name: string }
export type InboxStage = 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type ConversationState = {
  id: string
  assigned_user_id: string | null
  conversation_status: 'open' | 'closed'
  conversation_version: number
  inbound_seq: number
  bot_enabled: boolean
  unread_count: number
  inbox_stage?: InboxStage
  closed_at?: string | null
  close_reason?: string | null
}
export type InboxState = {
  viewerId: string
  members: InboxMember[]
  conversations: ConversationState[]
  aiAllowed: boolean
  pageName: string
  autoClaimOnReply?: boolean
  autoReplyEnabled?: boolean
  proEnabled?: boolean
  canManageTeam?: boolean
}
export type InboxMedia = { id: string; name: string; kind: 'image' | 'file' }
