type Customer = { id: string; display_name: string | null }

/** Legacy placeholder: replies now come from the context-aware agent pipeline. */
export async function botReply(_text: string, _customer: Customer): Promise<string | null> {
  return null
}
