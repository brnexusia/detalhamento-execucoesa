const request=async(url)=>{
 const ctrl=new AbortController()
 const timer=setTimeout(()=>ctrl.abort(),18000)
 try {
  const response=await fetch(url,{
    signal:ctrl.signal,redirect:'follow',headers:{'user-agent':'ShopVax scanner public-regression diagnostic'},
  })
  const body=await response.text()
  let data=null
  try {data=JSON.parse(body)}catch{}
  return {status:response.status,url:response.url,data,contentType:response.headers.get('content-type')}
 }finally{clearTimeout(timer)}
}
const main=await request('https://api.github.com/repos/brnexusia/detalhamento-execucoesa/commits/main')
const live=await request('https://shopvax.com.br/health')
const feature=await request('https://shopvax.com.br/api/admin/imports/00000000-test/recover-alexandre-preview')
const categories=await request('https://bijouxalexandre.com.br/api/categorias')
const expected=main.data?.sha
const deployed=live.data?.releaseSha
const distinct=Array.isArray(categories.data)?categories.data.length:0
console.log('ALEX_DEPLOY_RUNTIME',JSON.stringify({
 githubLatestSha:expected,
 liveReleaseSha:deployed,
 liveReleaseMatchesMain:!!expected && expected===deployed,
 healthStatus:live.status,databaseReady:live.data?.database,
 newRecoveryRouteWithoutSessionHttp:feature.status,
 categoryStatus:categories.status,publicCategoryCount:distinct,
}))
if (categories.status!==200 || !distinct) {
 console.log('ALEX_PUBLIC_CATALOG_UNAVAILABLE',JSON.stringify({
 status:categories.status, contentType:categories.contentType,
 }))
 process.exitCode=1
} else {
 let expectedCount=0, receivedCount=0
 for(const category of categories.data){
  const id=category?.id
  if(id==null)continue
  const result=await request('https://bijouxalexandre.com.br/api/categorias/'+encodeURIComponent(id)+'/produtos')
  expectedCount+=Number(category.totalPecas)||0
  if(result.status!==200 || !Array.isArray(result.data?.produtos)){
    console.log('ALEX_CATEGORY_FAILURE',JSON.stringify({categoryId:id,status:result.status}))
    process.exitCode=1
    continue
  }
  receivedCount+=result.data.produtos.length
 }
 console.log('ALEX_PUBLIC_CATALOG_TOTALS',JSON.stringify({expectedCount,receivedCount,matched:expectedCount===receivedCount}))
 if(receivedCount!==expectedCount || !receivedCount)process.exitCode=1
}
if (!expected || !deployed || expected!==deployed){
 console.log('ALEX_DEPLOY_BLOCKER: A versão de produção está diferente da main; o worker do scanner pode estar executando o coletor genérico antigo.')
}
