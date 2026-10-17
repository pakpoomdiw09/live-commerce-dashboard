/** BOT active institutions (Sep 2026), plus PromptPay. Existing stored codes remain stable.
 * SlipOK codes come only from its bank-code table, never from a logo pack.
 * Sources and unsupported channels: docs/BANK-REGISTRY.md.
 */
export type Bank={
 code:string;slipCode:string|null;name:string;englishName:string;short:string;color:string
 category:'commercial'|'foreign'|'specialized'|'payment';support:'slipok'|'manual'|'promptpay'
 aliases:readonly string[];logoPath:string|null;logoStatus:'installed'|'missing';logoBackground?:string
}
function bank(code:string,name:string,englishName:string,slipCode:string|null,category:Bank['category'],color='#475569',aliases:readonly string[]=[]):Bank{
 return {code,name:`ธนาคาร${name}`,englishName,slipCode,category,color,short:code,aliases,support:slipCode?'slipok':'manual',logoPath:null,logoStatus:'missing'}
}
const registry:Bank[]=[
 bank('KBANK','กสิกรไทย','Kasikornbank','004','commercial','#138f2d'),
 bank('SCB','ไทยพาณิชย์','Siam Commercial Bank','014','commercial','#4e2e7f'),
 bank('KTB','กรุงไทย','Krung Thai Bank','006','commercial','#1ba5e1'),
 bank('BBL','กรุงเทพ','Bangkok Bank','002','commercial','#1e4598'),
 bank('BAY','กรุงศรีอยุธยา','Bank of Ayudhya Krungsri','025','commercial','#d4a106'),
 bank('TTB','ทหารไทยธนชาต','TMBThanachart Bank','011','commercial','#0050f0',['TMB','TTBNK']),
 bank('CIMB','ซีไอเอ็มบี ไทย','CIMB Thai Bank','022','commercial','#7e2f36',['CIMBT']),
 bank('KKP','เกียรตินาคินภัทร','Kiatnakin Phatra Bank','069','commercial','#199cc5',['KK']),
 bank('TISCO','ทิสโก้','TISCO Bank','067','commercial','#12549f'),
 bank('UOB','ยูโอบี','United Overseas Bank Thai','024','commercial','#0b3979',['UOBT']),
 bank('TCRB','ไทยเครดิต','Thai Credit Bank','071','commercial','#0a4ab3',['TCD','ไทยเครดิตเพื่อรายย่อย']),
 bank('LH','แลนด์ แอนด์ เฮ้าส์','Land and Houses Bank','073','commercial','#6d6e71',['LHB','LHFG']),
 bank('ICBC','ไอซีบีซี (ไทย)','Industrial and Commercial Bank of China Thai','070','commercial','#c50f1c',['ICBCT']),
 bank('SCBT','สแตนดาร์ดชาร์เตอร์ด (ไทย)','Standard Chartered Bank Thai',null,'commercial','#0f6ea1',['SC']),
 bank('SMTB','ซูมิโตโม มิตซุย ทรัสต์ (ไทย)','Sumitomo Mitsui Trust Bank Thai',null,'commercial'),
 bank('MEGA','เมกะ สากลพาณิชย์','Mega International Commercial Bank',null,'commercial','#815e3b'),
 bank('BOC','แห่งประเทศจีน (ไทย)','Bank of China Thai',null,'commercial'),
 bank('CLICX','คลิกซ์','CLICX Bank',null,'commercial'),
 bank('JPM','เจพีมอร์แกน เชส','JPMorgan Chase Bank',null,'foreign','#321c10'),
 bank('CITI','ซิตี้แบงก์ เอ็น.เอ.','Citibank N.A.',null,'foreign','#1583c7'),
 bank('SMBC','ซูมิโตโม มิตซุย แบงกิ้ง คอร์ปอเรชั่น','Sumitomo Mitsui Banking Corporation',null,'foreign','#a0d235'),
 bank('DB','ดอยซ์แบงก์ เอจี','Deutsche Bank AG',null,'foreign','#0522a5'),
 bank('BNP','บีเอ็นพี พารีบาส์','BNP Paribas',null,'foreign','#14925e'),
 bank('MHCB','มิซูโฮ','Mizuho Bank',null,'foreign','#150b78',['MB','MIZUHO']),
 bank('BOFA','แห่งอเมริกา เนชั่นแนล แอสโซซิเอชั่น','Bank of America National Association',null,'foreign','#e11e3c',['BOA']),
 bank('RHB','อาร์ เอช บี','RHB Bank',null,'foreign'),
 bank('IOB','อินเดียน โอเวอร์ซีส์','Indian Overseas Bank',null,'foreign'),
 bank('OCBC','โอเวอร์ซี-ไชนีส แบงกิ้ง คอร์ปอเรชั่น','Oversea-Chinese Banking Corporation',null,'foreign'),
 bank('HSBC','ฮ่องกงและเซี่ยงไฮ้แบงกิ้งคอร์ปอเรชั่น','Hongkong and Shanghai Banking Corporation',null,'foreign','#fd0d1b'),
 bank('GSB','ออมสิน','Government Savings Bank','030','specialized','#eb198d'),
 bank('GHB','อาคารสงเคราะห์','Government Housing Bank','033','specialized','#f57d23'),
 bank('BAAC','เพื่อการเกษตรและสหกรณ์การเกษตร','Bank for Agriculture and Agricultural Cooperatives','034','specialized','#4b9b1d'),
 bank('EXIM','เพื่อการส่งออกและนำเข้าแห่งประเทศไทย','Export-Import Bank of Thailand','035','specialized'),
 bank('SME','พัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย','Small and Medium Enterprise Development Bank of Thailand','098','specialized'),
 bank('IBANK','อิสลามแห่งประเทศไทย','Islamic Bank of Thailand',null,'specialized','#184615'),
 {code:'PROMPTPAY',slipCode:null,name:'พร้อมเพย์',englishName:'PromptPay',short:'PP',color:'#003b71',category:'payment',support:'promptpay',aliases:[],logoPath:null,logoStatus:'missing'},
]
// Only current, visually reviewed assets with a redistributable source license.
const logoFiles:Record<string,string>={KBANK:'kbank',SCB:'scb',KTB:'ktb',BBL:'bbl',BAY:'bay',TTB:'ttb',GSB:'gsb',CIMB:'cimb',TISCO:'tisco',UOB:'uob',LH:'lhb',ICBC:'icbc',BAAC:'baac',GHB:'ghb',SCBT:'sc',MEGA:'mega',JPM:'jpm',CITI:'citi',SMBC:'smbc',DB:'db',BNP:'bnp',MHCB:'mb',BOFA:'boa',HSBC:'hsbc',IBANK:'ibank',KKP:'kkp',TCRB:'tcrb',SME:'sme',EXIM:'exim',OCBC:'ocbc',RHB:'rhb',IOB:'iob',SMTB:'smtb',PROMPTPAY:'promptpay.png'}
const fullColorLogos=new Set(['KKP','TCRB','SME','EXIM','OCBC','RHB','IOB','SMTB','PROMPTPAY'])
for(const entry of registry){const file=logoFiles[entry.code];if(file){entry.logoPath=`/banks/${file.includes('.')?file:file+'.svg'}`;entry.logoStatus='installed';if(fullColorLogos.has(entry.code))entry.logoBackground='#ffffff'}}
const priority=['KBANK','SCB','KTB','BBL','BAY']
export const BANKS:Bank[]=registry.sort((a,b)=>{
 const ai=priority.indexOf(a.code),bi=priority.indexOf(b.code)
 if(ai!==-1||bi!==-1)return (ai===-1?priority.length:ai)-(bi===-1?priority.length:bi)
 return a.name.replace(/^ธนาคาร/,'').localeCompare(b.name.replace(/^ธนาคาร/,''),'th')
})
/** Lookup confirmed SlipOK numeric codes, stable internal codes, or legacy aliases. */
export function findBank(code:string|null|undefined):Bank|undefined{
 const value=(code??'').trim().toUpperCase()
 if(!value)return undefined
 return BANKS.find(bank=>bank.code===value||bank.slipCode===value||bank.aliases.includes(value))
}
export const BANK_CODES=BANKS.map(bank=>bank.code)
/** Selectable banks must appear in SlipOK's documented bank-code table. */
export const SUPPORTED_BANKS=BANKS.filter(bank=>bank.support==='slipok'&&bank.slipCode!==null)
export function isSupportedBank(code:string|null|undefined):boolean{
 const bank=findBank(code)
 return bank?.support==='slipok'&&bank.slipCode!==null
}
export const UNSUPPORTED_BANK_MESSAGE='ธนาคารนี้ยังไม่รองรับการตรวจสลิปอัตโนมัติ กรุณาเลือกธนาคารที่ระบบตรวจสอบสลิปรองรับ'
