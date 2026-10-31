export type LiveCfMetaAdapter = {
  sendPrivateText(commentId: string, text: string): Promise<void>
  sendPublicText(commentId: string, text: string): Promise<void>
}

type Sender = (commentId: string, text: string) => Promise<unknown>

const clean = (text: string) => text.normalize('NFC').trim().slice(0, 2000)

/** Meta-compliant Live CF adapter: exactly one text payload, never a raw image attachment. */
export function createLiveCfMetaAdapter(input: {
  privateText: Sender
  publicText: Sender
}): LiveCfMetaAdapter {
  return {
    async sendPrivateText(commentId, text) {
      const message = clean(text)
      if (!message) throw new Error('LIVE_CF_PRIVATE_TEXT_REQUIRED')
      await input.privateText(commentId, message)
    },
    async sendPublicText(commentId, text) {
      const message = clean(text)
      if (!message) throw new Error('LIVE_CF_PUBLIC_TEXT_REQUIRED')
      await input.publicText(commentId, message)
    },
  }
}

/** Test adapter; no Graph API request can escape a unit test. */
export function createMockLiveCfMetaAdapter() {
  const privateMessages: { commentId: string; text: string }[] = []
  const publicMessages: { commentId: string; text: string }[] = []
  return {
    privateMessages,
    publicMessages,
    adapter: createLiveCfMetaAdapter({
      privateText: async (commentId, text) => void privateMessages.push({ commentId, text }),
      publicText: async (commentId, text) => void publicMessages.push({ commentId, text }),
    }),
  }
}
