import base64, json, os, subprocess, tempfile, urllib.request
url='https://www.vxinstagram.com/offload/DflC1XhPNhx/0.mp4'
headers={'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36','Referer':'https://www.vxinstagram.com/'}
with tempfile.TemporaryDirectory() as d:
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=40) as response:
        video=response.read(50*1024*1024)
        print('IG_VIDEO_INFO '+json.dumps({'http':response.status,'bytes':len(video),'mime':response.headers.get('content-type','')}),flush=True)
    source=os.path.join(d,'post.mp4')
    with open(source,'wb') as f:f.write(video)
    probe=subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',source]).decode().strip()
    duration=float(probe)
    print('IG_VIDEO_DURATION '+str(duration),flush=True)
    poster=os.path.join(d,'contact.jpg')
    fps=12/max(1,duration)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',source,
     '-vf',f'fps={fps:.5f},scale=300:520:force_original_aspect_ratio=decrease,pad=300:520:(ow-iw)/2:(oh-ih)/2:color=white,tile=4x3',
     '-frames:v','1','-q:v','5',poster],check=True,timeout=120)
    data=open(poster,'rb').read()
    print('IG_VIDEO_SHEET_B64 '+base64.b64encode(data).decode(),flush=True)
    # Extract video frames with native resolution for subtitles text.
    for at in [duration*0.15,duration*0.4,duration*0.65,duration*0.9]:
        target=os.path.join(d,'still.png')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss',str(at),'-i',source,'-frames:v','1',target],check=True,timeout=30)
        # Tesseract only examines captions on public video frames.
        p=subprocess.run(['tesseract',target,'stdout','-l','eng','--psm','11'],capture_output=True,text=True,timeout=15)
        print('IG_FRAME_TEXT '+json.dumps({'second':round(at,1),'text':p.stdout[:1300].replace('\n',' ')}),flush=True)
