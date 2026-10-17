import React,{StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {SmartInboxV2} from '../../../components/inbox/SmartInboxV2'
import {customers,messages,installFetch,metrics,replay,reconnect,threadChange} from './mocks'
installFetch()
Object.assign(window,{inboxTest:{metrics,replay,reconnect,threadChange}})
createRoot(document.getElementById('root')!).render(<StrictMode><SmartInboxV2 initialChats={customers.map((customer,i)=>({customer:customer as never,preview:messages[i] as never,latestSlip:null}))} initialComments={[]} initialSelectedId={customers[0].id} tenant={{id:'test-shop',name:'ร้านทดสอบออฟไลน์',autoReply:true,autoVerify:false}}/></StrictMode>)
