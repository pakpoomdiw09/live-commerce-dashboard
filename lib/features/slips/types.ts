export type SlipVerdict = Exclude<import('@/lib/domain-state').LegacySlipState, 'pending'>

export type SlipProviderDiagnostic = {
  provider: 'zwiz' | 'slipok' | 'unknown'
  stage: string
  httpStatus: number | null
  code: string | null
  message: string | null
}

export type SlipResult = {
  receiverVerifiedByProvider?: boolean
  /** The selected provider explicitly matched the receiving-account list sent with the request. */
  matchedBankAccount?: boolean
  /** Provider verified the slip but skipped matching it against receiver accounts. */
  receiverCheckSkipped?: boolean
  verdict: SlipVerdict
  amount?: number
  transRef?: string
  /** Receiver account as printed on the slip, usually masked. */
  receiverAccount?: string
  /** Receiving bank as a provider-specific code. */
  receiverBank?: string
  receiverProxy?: string
  /** The provider returned slip data despite not matching the receiver automatically. */
  branchReceiverMismatch?: boolean
  /** Failure is attributable to provider availability or our provider setup, not the slip. */
  providerFault?: boolean
  /** Sanitized provider error details; never contains credentials or full provider payloads. */
  providerDiagnostic?: SlipProviderDiagnostic
  note?: string
  raw: unknown
}

export type SlipVerificationAccount = { accountNo: string; bankCode: string }

export type SlipVerificationInput = {
  file?: File
  qr?: string
  expectedAmount?: number
  log?: boolean
  bankAccounts?: readonly SlipVerificationAccount[]
  shopName?: string
}
