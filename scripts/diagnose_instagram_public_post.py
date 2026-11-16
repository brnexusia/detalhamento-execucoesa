#!/usr/bin/env python3
"""Read-only public Instagram diagnostics for a user-shared shortcode."""
import concurrent.futures, html, json, re, urllib.request, urllib.error
from urllib.parse import quote
CODE='DflC1XhPNhx'
urls={
'original':f'https://www.instagram.com/p/{CODE}/',
'embed':f'https://www.instagram.com/p/{CODE}/embed/captioned/',
'embed2':f'https://www.instagram.com/p/{CODE}/embed/',
'api':f'https://www.instagram.com/p/{CODE}/?__a=1&__d=dis',
'ig-alt':f'https://www.instagr.am/p/{CODE}/',
'jina':f'https://r.jina.ai/https://www.instagram.com/p/{CODE}/',
'jina-embed':f'https://r.jina.ai/https://www.instagram.com/p/{CODE}/embed/captioned/',
'oginstagram':f'https://oginstagram.com/p/{CODE}/',
'vxinstagram':f'https://www.vxinstagram.com/p/{CODE}/',
'ddinstagram':f'https://www.ddinstagram.com/p/{CODE}/',
'kkinstagram':f'https://www.kkinstagram.com/p/{CODE}/',
'google':f'https://www.google.com/search?q=%22{CODE}%22',
'bing':f'https://www.bing.com/search?q=%22{CODE}%22',
}
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
def fetch(item):
 key,url=item
 try:
  headers={'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5','Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'}
  if key.startswith('jina'): headers['X-Return-Format']='markdown'
  req=urllib.request.Request(url,headers=headers)
  with urllib.request.urlopen(req,timeout=24) as response:
   body=response.read(3500000).decode('utf-8','replace')
   final=response.geturl()
   status=response.status
   ctype=response.headers.get('Content-Type','')
  tags={}
  for prop in ['og:title','og:description','og:image','og:video','twitter:title','twitter:description','twitter:image']:
    for regex in [
      rf'<meta[^>]+(?:property|name)\s*=\s*["\x27]{re.escape(prop)}["\x27][^>]+content\s*=\s*["\x27]([^"\x27]+)',
      rf'<meta[^>]+content\s*=\s*["\x27]([^"\x27]+)["\x27][^>]+(?:property|name)\s*=\s*["\x27]{re.escape(prop)}["\x27]',
    ]:
     m=re.search(regex,body,re.I)
     if m: tags[prop]=html.unescape(m.group(1))[:1600];break
  title=re.search(r'<title[^>]*>(.*?)</title>',body,re.I|re.S)
  if title:tags['htmlTitle']=html.unescape(title.group(1)).strip()[:500]
  if key.startswith('jina'): tags['text']=body[:9000]
  else:
   for term in ['caption','description','video_url','display_url','og:image','reel','post_id','shortcode','DflC1XhPNhx']:
    j=body.lower().find(term.lower())
    if j>=0:tags['context_'+term]=body[max(0,j-70):j+350].replace('\n',' ')[:440]
  return {'source':key,'http':status,'final':final[:170],'bytes':len(body),'contentType':ctype[:65], 'tags':tags}
 except Exception as e:return {'source':key,'error':str(e)[:240]}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for result in pool.map(fetch,urls.items()):
  print('IG_DIAG '+json.dumps(result,ensure_ascii=False),flush=True)
