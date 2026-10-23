export function supabaseBrowser() {
  const channel = {
    on() {
      return channel
    },
    subscribe() {
      return channel
    },
  }
  return { channel: () => channel, removeChannel: async () => {} }
}
