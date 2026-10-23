export class AiAgentError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 503,
  ) {
    super(message)
    this.name = 'AiAgentError'
  }
}
