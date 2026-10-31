import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'

const slides = [
  ['01 / CATÁLOGO','ESCOLHA AS PEÇAS','Explore as coleções e confira os produtos.','Fotos e preços vêm da loja.'],
  ['02 / GRADE','MONTE A GRADE','Defina variações e quantidades.','Confira cor, tamanho e estoque.'],
  ['03 / TALÃO','REVISE O PEDIDO','Confira o mínimo e o total de peças.','Talão preparado não é venda confirmada.'],
  ['04 / WHATSAPP','CONVERSE COM A VENDEDORA','Abra a conversa pela ação do comprador.','Abrir não comprova envio ou pagamento.'],
]
const temp = await mkdtemp(join(tmpdir(), 'shopvax-guide-'))
const outputDir = resolve('public/help')
const output = join(outputDir, 'shopvax-guide.mp4')
const xml = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
try {
  await mkdir(outputDir,{recursive:true})
  for (let i=0;i<slides.length;i++){
    const [tag,title,description,footnote] = slides[i].map(xml)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#F3F0E8"/>
      <rect width="640" height="22" fill="#F25C05"/><rect y="22" width="640" height="6" fill="#161514"/>
      <text x="35" y="85" font-family="DejaVu Sans" font-size="23" font-weight="700" fill="#F25C05">${tag}</text>
      <text x="35" y="148" font-family="DejaVu Sans" font-size="39" font-weight="700" fill="#161514">${title}</text>
      <path d="M35 172H605" stroke="#D9D3C6" stroke-width="2"/>
      <text x="35" y="220" font-family="DejaVu Sans" font-size="20" fill="#161514">${description}</text>
      <text x="35" y="268" font-family="DejaVu Sans" font-size="16" fill="#56534E">${footnote}</text>
      <rect x="35" y="315" width="570" height="4" fill="#D9D3C6"/>
      <rect x="35" y="315" width="${Math.floor((i+1)*570/slides.length)}" height="4" fill="#F25C05"/>
      <text x="542" y="344" font-family="DejaVu Sans" font-size="11" font-weight="700" fill="#161514">SHOPVAX</text>
    </svg>`
    await sharp(Buffer.from(svg)).png().toFile(join(temp,'frame-'+i+'.png'))
  }
  const args=['-y','-loglevel','error','-framerate','1/3','-start_number','0','-i',join(temp,'frame-%d.png'),
    '-vf','fps=10,format=yuv420p','-t','12','-c:v','libx264','-preset','veryfast','-crf','30',
    '-movflags','+faststart','-an',output]
  const result = spawnSync('ffmpeg',args,{encoding:'utf8',timeout:120000})
  if(result.error || result.status!==0) throw new Error('Não foi possível gerar o vídeo: '+String(result.stderr || result.error || result.status))
  const {size}=await stat(output)
  if (size < 5000 || size > 1_000_000) throw new Error('Vídeo fora do orçamento de 5 KB–1 MB: '+size)
  console.log('Shopvax tutorial criado: '+output+' ('+size+' bytes, 12 segundos, sem áudio)')
} finally {
  await rm(temp,{recursive:true,force:true})
}
