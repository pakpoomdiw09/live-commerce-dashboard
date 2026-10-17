/** Only expose adapters with an implemented transport; additional channels are not connected. */
export interface InboxChannelAdapter {
 id:string
 label:string
 capabilities:{attachments:boolean;drafts:boolean;deliveryReceipts:boolean;standardWindowHours:number}
}
export const inboxChannels:readonly InboxChannelAdapter[]=[{
 id:'facebook',label:'Facebook Messenger',
 capabilities:{attachments:true,drafts:true,deliveryReceipts:true,standardWindowHours:24},
}]
