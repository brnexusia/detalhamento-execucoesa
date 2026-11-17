import glob,json,time,os
from rapidocr import RapidOCR
start=time.monotonic()
reader=RapidOCR()
print('RAPID_OCR_ENGINE_READY '+json.dumps({'seconds':round(time.monotonic()-start,1)}),flush=True)
for path in sorted(glob.glob('/tmp/mama-rapid/*.png')):
 begin=time.monotonic()
 try:
  result=reader(path)
  texts=getattr(result,'txts',None)
  scores=getattr(result,'scores',None)
  if texts is None:
   texts=str(result)[:1800]
  print('MAMA_RAPID_RESULT '+json.dumps({
   'photo':os.path.basename(path),
   'texts':texts,'scores':scores.tolist() if hasattr(scores,'tolist') else scores,
   'seconds':round(time.monotonic()-begin,2),
  },ensure_ascii=False,default=str),flush=True)
 except Exception as e:print('MAMA_RAPID_ERROR '+json.dumps({'photo':os.path.basename(path),'error':str(e)}),flush=True)
