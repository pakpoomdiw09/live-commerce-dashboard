type Customer = { id: string; display_name: string | null }

/** Return the reply text, or null to stay silent. Replace the body with your FAQ lookup or an LLM call. */
export async function botReply(text: string, _customer: Customer): Promise<string | null> {
  if (/ราคา|เท่าไหร่/.test(text)) return 'สอบถามราคาได้เลยค่ะ แอดมินจะแจ้งรายละเอียดให้นะคะ'
  if (/โอน|ชำระ/.test(text)) return 'โอนแล้วส่งสลิปมาในแชทนี้ได้เลยค่ะ'
  return 'ขอบคุณที่ทักมาค่ะ แอดมินจะตอบกลับโดยเร็วที่สุดนะคะ'
}
