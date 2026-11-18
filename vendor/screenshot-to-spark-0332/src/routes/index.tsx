import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import feed1 from "@/assets/feed-1.jpg";
import feed2 from "@/assets/feed-2.jpg";
import store from "@/assets/store.jpg";
import { LINKS } from "@/lib/links";
import { Intro } from "@/components/Intro";
import logoH from "@/assets/shopvax-horizontal-cor-negativo.png.asset.json";
import logoV from "@/assets/shopvax-vertical-cor-negativo.png.asset.json";
import symbol from "@/assets/shopvax-favicon-512.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ShopVax — Catálogo digital com feed de produtos, sem comissão" },
      {
        name: "description",
        content:
          "Transforme seu catálogo em uma experiência de compra. Pedidos organizados por vendedora direto no WhatsApp. Sem comissão. Planos de Black Friday a partir de R$ 29,99.",
      },
      { property: "og:title", content: "ShopVax — Seus produtos em um novo jeito de vender" },
      {
        property: "og:description",
        content: "Feed de produtos, talão com grade e pedidos direto no WhatsApp da vendedora certa. Sem comissão.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/* ---------- reusable ---------- */
function Btn({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "ghost" | "dark" | "light" }) {
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-foreground hover:text-background",
    dark: "bg-foreground text-background hover:bg-primary hover:text-primary-foreground",
    ghost: "border border-current hover:bg-foreground hover:text-background",
    light: "border border-background/40 text-background hover:bg-background hover:text-foreground",
  }[variant];
  return (
    <a href={href} className={`group inline-flex items-center justify-center gap-3 px-6 py-4 font-display text-lg tracking-wide transition-colors duration-200 ${v}`}>
      {children}
      <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
    </a>
  );
}
function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`tag ${className}`}>{children}</span>;
}
function SectionHead({ n, label, title, dark }: { n: string; label: string; title: ReactNode; dark?: boolean }) {
  return (
    <div className="mb-12 grid gap-6 md:grid-cols-12">
      <Tag className={`md:col-span-3 ${dark ? "text-background/60" : "text-muted-foreground"}`}>
        {n} / {label}
      </Tag>
      <h2 className="text-5xl md:col-span-9 md:text-7xl">{title}</h2>
    </div>
  );
}

/* ---------- phone ---------- */
const FEED = [
  { img: feed1, store: "@atelie.laranja", name: "Conjunto Linho Alfaiataria", cat: "Conjuntos", price: "R$ 189,90" },
  { img: feed2, store: "@malharia.sul", name: "Tricô Trançado — Grade P/M/G", cat: "Tricô", price: "R$ 64,90" },
  { img: store, store: "@casa.brasilis", name: "Vestido Midi Estampado", cat: "Vestidos", price: "R$ 129,90" },
];
function Phone() {
  return (
    <div className="relative mx-auto w-[270px] md:w-[300px]">
      <div className="rounded-[2.6rem] bg-foreground p-2.5 shadow-2xl">
        <div className="relative aspect-[9/19] overflow-hidden rounded-[2.1rem] bg-foreground">
          <div className="feed-scroll absolute inset-x-0 top-0 h-[300%]">
            {FEED.map((p, i) => (
              <div key={i} className="relative h-1/3">
                <img src={p.img} alt={p.name} className="h-full w-full object-cover" width={768} height={1344} loading={i ? "lazy" : "eager"} />
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/90 via-transparent to-foreground/30" />
                <div className="absolute left-4 right-4 top-8 flex justify-between text-background">
                  <Tag>{p.store}</Tag>
                  <Tag className="bg-background/20 px-2 py-0.5">{p.cat}</Tag>
                </div>
                <div className="absolute right-3 top-1/2 flex flex-col gap-4 text-background">
                  <span aria-label="Favoritar" className="grid h-9 w-9 place-items-center rounded-full bg-background/20">♥</span>
                </div>
                <div className="absolute bottom-5 left-4 right-4 text-background">
                  <p className="font-display text-xl leading-tight">{p.name}</p>
                  <p className="tag mt-1 text-sm">{p.price}</p>
                  <div className="mt-3 bg-primary py-2.5 text-center font-display text-sm text-primary-foreground">MONTAR PEDIDO</div>
                </div>
              </div>
            ))}
          </div>
          <div className="absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full bg-foreground" />
        </div>
      </div>
    </div>
  );
}

/* ---------- sections ---------- */
function Nav() {
  const items = [["Como funciona", "#como-funciona"], ["Recursos", "#recursos"], ["Planos", "#planos"], ["Parceiros", "#parceiros"], ["FAQ", "#faq"]];
  return (
    <header className="sticky top-0 z-50 bg-foreground text-background">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
        <a href="#" aria-label="ShopVax — início"><img src={logoH.url} alt="ShopVax" width={2000} height={731} className="h-14 w-auto" /></a>
        <nav className="hidden gap-7 md:flex">
          {items.map(([l, h]) => <a key={h} href={h} className="tag text-background/80 hover:text-primary">{l}</a>)}
        </nav>
        <a href={LINKS.signup} className="bg-primary px-4 py-2 font-display text-sm text-primary-foreground hover:bg-background hover:text-foreground">QUERO MINHA LOJA</a>
      </div>
    </header>
  );
}

function Hero() {
  const points = ["Sem comissão sobre suas vendas", "Pedidos organizados por vendedora", "Catálogo com experiência de feed", "Planos promocionais de Black Friday"];
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-10 md:grid-cols-12 md:pb-24 md:pt-16">
        <div className="rise md:col-span-7">
          <Tag className="inline-block bg-foreground px-2 py-1 text-background">● Black Friday · Nov–Dez 2026</Tag>
          <h1 className="mt-6 text-[17vw] md:text-[8.2rem]">
            Seus produtos.<br />
            <span className="text-primary">Em um novo</span><br />jeito de vender.
          </h1>
          <p className="mt-8 max-w-xl text-lg text-muted-foreground">
            Transforme seu catálogo em uma experiência de compra. Seus clientes descobrem produtos, montam pedidos e chegam diretamente ao WhatsApp da sua equipe.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Btn href={LINKS.signup}>QUERO MINHA LOJA</Btn>
            <Btn href="#como-funciona" variant="ghost">VER COMO FUNCIONA</Btn>
          </div>
          <ul className="mt-10 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-6">
            {points.map((p) => (
              <li key={p} className="flex gap-2 text-sm"><span className="text-primary">✓</span>{p}</li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center justify-center md:col-span-5">
          <div className="absolute inset-x-0 top-10 bottom-10 bg-accent md:-right-20" aria-hidden />
          <Tag className="absolute left-0 top-4 text-carbon">↓ feed de produtos</Tag>
          <div className="relative rise" style={{ animationDelay: "150ms" }}><Phone /></div>
          <div className="absolute bottom-16 left-0 bg-foreground px-3 py-2 text-background md:-left-6">
            <Tag className="text-primary">0%</Tag>
            <p className="font-display text-lg leading-none">COMISSÃO</p>
          </div>
        </div>
      </div>
      <div className="overflow-hidden border-y border-foreground bg-foreground py-3 text-background">
        <div className="marquee flex w-max gap-10 whitespace-nowrap">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k} className="flex gap-10">
              {["CATÁLOGO", "FEED", "GRADE", "TALÃO", "WHATSAPP", "SEM COMISSÃO", "LINK POR VENDEDORA", "CATÁLOGO EM PDF"].map((w) => (
                <span key={w} className="font-display text-2xl">{w} <span className="text-primary">✦</span></span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Experience() {
  const f = ["Feed vertical de produtos", "Navegação contínua", "Produtos em tela cheia", "Favoritos", "Descoberta de novas lojas", "Montagem de pedidos"];
  return (
    <section className="mx-auto max-w-7xl px-5 py-24">
      <SectionHead n="01" label="Não é só um catálogo" title={<>Seu catálogo virou <span className="text-primary">uma experiência.</span></>} />
      <div className="grid gap-10 md:grid-cols-12">
        <div className="md:col-span-7">
          <img src={store} alt="Lojista organizando peças na loja" loading="lazy" width={1344} height={896} className="aspect-[4/3] w-full object-cover" />
        </div>
        <div className="md:col-span-5">
          <p className="text-xl">A ShopVax muda a forma como seus clientes descobrem e escolhem produtos: em vez de uma lista, um feed para rolar — produto por produto, loja por loja.</p>
          <ol className="mt-8 divide-y divide-border border-y border-border">
            {f.map((x, i) => (
              <li key={x} className="flex items-baseline gap-5 py-4">
                <Tag className="text-primary">{String(i + 1).padStart(2, "0")}</Tag>
                <span className="font-display text-2xl">{x}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [["01", "Catálogo", "Escolha suas peças."], ["02", "Grade", "Defina cor, tamanho e quantidade."], ["03", "Talão", "Prepare o pedido para a vendedora."], ["04", "WhatsApp", "O pedido chega preparado à vendedora certa."]];
  return (
    <section id="como-funciona" className="scroll-mt-16 bg-foreground py-24 text-background">
      <div className="mx-auto max-w-7xl px-5">
        <SectionHead dark n="02" label="Como funciona" title={<>O cliente escolhe.<br /><span className="text-primary">Sua vendedora fecha.</span></>} />
        <div className="grid border-t border-background/20 md:grid-cols-4">
          {steps.map(([n, t, d]) => (
            <div key={n} className="group border-b border-background/20 py-8 transition-colors hover:bg-primary md:border-b-0 md:border-r md:px-6 md:last:border-r-0">
              <span className="font-display text-7xl text-primary group-hover:text-foreground">{n}</span>
              <h3 className="mt-6 text-3xl">{t}</h3>
              <p className="mt-2 text-background/70 group-hover:text-background">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-12 max-w-2xl text-lg text-background/70">Uma loja simples para mostrar produtos, montar grades e preparar o pedido para o WhatsApp certo.</p>
      </div>
    </section>
  );
}

function Features() {
  const main = [["Loja", "Catálogo direto e pesquisável."], ["Feed", "Produto em tela cheia para rolar."], ["Talão", "Grade, quantidade e pedido mínimo."], ["WhatsApp", "O pedido chega preparado à vendedora certa."]];
  const more = ["Busca por nome e referência", "Filtro por categoria", "Carrinho com grade", "Aviso de quanto falta para o pedido mínimo", "Catálogo em PDF", "Link individual por vendedora", "Pedidos numerados e registrados", "Identificação de quem atendeu"];
  return (
    <section id="recursos" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-24">
      <SectionHead n="03" label="Recursos" title="Tudo que a sua loja precisa para vender." />
      <div className="grid gap-px bg-border md:grid-cols-4">
        {main.map(([t, d]) => (
          <div key={t} className="bg-background p-6">
            <h3 className="text-4xl text-primary">{t}</h3>
            <p className="mt-3">{d}</p>
          </div>
        ))}
      </div>
      <ul className="mt-12 grid gap-x-10 sm:grid-cols-2">
        {more.map((m) => (
          <li key={m} className="flex justify-between border-b border-border py-3"><span>{m}</span><Tag className="text-carbon">incluso</Tag></li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted-foreground">Todos os planos possuem catálogo, pedidos por WhatsApp e produtos conforme os limites do plano.</p>
    </section>
  );
}

function NoCommission() {
  const flow = ["Cliente escolhe os produtos", "Monta sua grade", "Finaliza o talão", "Pedido vai ao WhatsApp da vendedora responsável", "A vendedora finaliza a negociação"];
  return (
    <section className="bg-primary py-24 text-primary-foreground">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 md:grid-cols-12">
        <div className="md:col-span-7">
          <Tag>04 / Sem comissão</Tag>
          <h2 className="mt-6 text-6xl md:text-8xl">Você vende.<br />Você recebe.<br /><span className="text-foreground">Sem comissão.</span></h2>
          <p className="mt-8 max-w-lg text-xl">A ShopVax organiza a experiência de compra, mas quem fecha a venda continua sendo sua equipe. Não cobramos comissão sobre o valor das suas vendas.</p>
        </div>
        <ol className="space-y-2 md:col-span-5 md:pt-16">
          {flow.map((f, i) => (
            <li key={f} className="flex items-center gap-4 bg-foreground/10 p-4">
              <span className="font-display text-3xl">{i + 1}</span><span>{f}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const PLANS = [
  { name: "Bronze", price: "29,99", href: LINKS.bronze, rows: ["2", "1", "5", "1", "Ilimitados"] },
  { name: "Prata", price: "49,99", href: LINKS.prata, rows: ["4", "3", "10", "2", "Ilimitados"], rec: true },
  { name: "Ouro", price: "69,99", href: LINKS.ouro, rows: ["Ilimitadas", "Ilimitados", "Ilimitadas", "Ilimitados", "Ilimitados"] },
];
const ROWS = ["Vendedoras", "Catálogos", "Fotos por produto", "Franqueados", "Produtos"];
function Plans() {
  const all = ["Catálogo com busca", "Feed em tela cheia", "Carrinho com grade", "Catálogo em PDF", "Link por vendedora", "Pedidos no painel", "Pedidos direcionados ao WhatsApp"];
  return (
    <section id="planos" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-24">
      <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <Tag className="bg-foreground px-2 py-1 text-background">05 / Condições especiais de Black Friday</Tag>
          <h2 className="mt-6 text-5xl md:text-7xl">Mais tecnologia para sua loja<br /><span className="text-primary">por menos de R$ 70/mês.</span></h2>
        </div>
        <Tag className="text-muted-foreground">Válido em novembro e dezembro de 2026</Tag>
      </div>
      <div className="grid gap-4 md:grid-cols-3 md:gap-0">
        {PLANS.map((p) => (
          <div key={p.name} className={`relative flex flex-col border border-foreground p-7 md:-ml-px ${p.rec ? "bg-accent md:-my-4 md:py-11" : "bg-card"}`}>
            {p.rec && <Tag className="absolute -top-3 left-7 bg-primary px-2 py-1 text-primary-foreground">★ Recomendado</Tag>}
            <h3 className="text-4xl">{p.name}</h3>
            <p className="mt-4 flex items-baseline gap-1"><Tag>R$</Tag><span className="font-display text-7xl">{p.price}</span><Tag>/mês</Tag></p>
            <dl className="mt-6 flex-1 divide-y divide-border border-t border-border">
              {ROWS.map((r, i) => (
                <div key={r} className="flex justify-between py-3"><dt className="text-muted-foreground">{r}</dt><dd className="font-semibold">{p.rows[i]}</dd></div>
              ))}
            </dl>
            <div className="mt-6 grid">
              <Btn href={p.href} variant={p.rec ? "primary" : "dark"}>COMEÇAR NO {p.name.toUpperCase()}</Btn>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-12 border-t border-foreground pt-6">
        <Tag className="text-muted-foreground">Todos os planos incluem</Tag>
        <ul className="mt-4 flex flex-wrap gap-2">
          {all.map((a) => <li key={a} className="border border-border px-3 py-1.5 text-sm">✓ {a}</li>)}
        </ul>
      </div>
    </section>
  );
}

function Buyers() {
  const items = ["Criar seu perfil de comprador", "Acompanhar lojas favoritas", "Receber avisos por WhatsApp e e-mail quando suas lojas lançarem novos produtos", "Ser avisados sobre novos catálogos"];
  return (
    <section className="bg-accent py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 md:grid-cols-12">
        <div className="md:col-span-7">
          <Tag className="text-muted-foreground">06 / Perfil de comprador</Tag>
          <h2 className="mt-6 text-5xl md:text-6xl">Seus clientes não precisam procurar sua loja. <span className="text-primary">Eles podem acompanhá-la.</span></h2>
          <ul className="mt-8 space-y-3">
            {items.map((i) => <li key={i} className="flex gap-3 text-lg"><span className="text-primary">→</span>{i}</li>)}
          </ul>
        </div>
        <div className="space-y-3 md:col-span-5 md:pt-10" aria-label="Exemplo de notificações">
          {[["WhatsApp", "@atelie.laranja lançou 12 novos produtos."], ["E-mail", "Novo catálogo: Coleção Verão 27 — @malharia.sul"], ["ShopVax", "Você está seguindo 8 lojas."]].map(([c, t], i) => (
            <div key={i} className="rise flex gap-4 border border-foreground bg-background p-4" style={{ animationDelay: `${i * 120}ms`, marginLeft: `${i * 1.5}rem` }}>
              <img src={symbol.url} alt="" width={40} height={40} className="h-10 w-10 shrink-0" />
              <div><Tag className="text-carbon">{c} · agora</Tag><p className="mt-1">{t}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Partners() {
  const steps = ["Cadastro como parceiro", "Link individual de indicação", "Compartilhamento com lojistas", "Reconhecimento das assinaturas feitas pelo link", "50% de comissão sobre o valor da assinatura de qualquer plano"];
  return (
    <section id="parceiros" className="scroll-mt-16 bg-foreground py-24 text-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 md:grid-cols-12">
        <div className="md:col-span-6">
          <Tag className="text-background/60">07 / Seja um parceiro ShopVax</Tag>
          <h2 className="mt-6 text-6xl md:text-8xl">Indique.<br />Conecte.<br /><span className="text-primary">Ganhe.</span></h2>
          <p className="mt-6 text-lg text-background/70">Você conhece lojistas? Transforme suas conexões em oportunidades.</p>
          <div className="mt-8"><Btn href={LINKS.partner}>QUERO SER PARCEIRO</Btn></div>
        </div>
        <div className="md:col-span-6">
          <div className="border border-primary p-6">
            <Tag className="text-primary">Oferta nov–dez 2026</Tag>
            <p className="mt-3 font-display text-4xl leading-none md:text-5xl"><span className="text-primary">50%</span> de comissão sobre o valor de cada assinatura indicada.</p>
          </div>
          <ol className="mt-6 divide-y divide-background/15">
            {steps.map((s, i) => <li key={s} className="flex gap-4 py-3"><Tag className="text-primary">0{i + 1}</Tag>{s}</li>)}
          </ol>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ["O que é a ShopVax?", "Uma plataforma de catálogo digital e social commerce para lojas, atacadistas, varejistas e vendedores, com um feed de descoberta dedicado a produtos e lojas."],
  ["Como funciona o catálogo digital?", "Seus produtos ficam em um catálogo pesquisável e em um feed em tela cheia. O cliente escolhe as peças, define cor, tamanho e quantidade e monta o talão."],
  ["A ShopVax cobra comissão sobre minhas vendas?", "Não. A ShopVax não cobra comissão sobre o valor das vendas realizadas pelas lojas. Você paga apenas o plano."],
  ["Como os pedidos chegam às vendedoras?", "O talão finalizado é direcionado ao WhatsApp da vendedora responsável, já preparado, e fica registrado e numerado no painel."],
  ["Posso ter mais de uma vendedora?", "Sim. O Bronze inclui 2 vendedoras, o Prata 4 e o Ouro vendedoras ilimitadas, cada uma com link individual."],
  ["Posso ter vários catálogos?", "Sim. O Bronze inclui 1 catálogo, o Prata 3 e o Ouro catálogos ilimitados."],
  ["Como funciona o perfil de comprador?", "Seus clientes criam um perfil para acompanhar lojas favoritas e serem avisados sobre novos produtos e catálogos."],
  ["Como recebo notificações de novas coleções?", "Compradores que seguem uma loja recebem avisos por WhatsApp e e-mail quando ela lança novos produtos ou catálogos."],
  ["Como faço para assinar?", "Escolha um plano nesta página e clique no botão correspondente para iniciar seu cadastro."],
  ["Como funciona o programa de parceiros?", "Você se cadastra, recebe um link individual e o compartilha com lojistas. Em novembro e dezembro de 2026, recebe 50% de comissão sobre o valor de cada assinatura feita pelo seu link."],
];
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-5xl scroll-mt-16 px-5 py-24">
      <SectionHead n="08" label="FAQ" title="Perguntas frequentes" />
      <div className="border-t border-foreground">
        {FAQ.map(([q, a], i) => (
          <div key={q} className="border-b border-border">
            <button aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-6 py-5 text-left">
              <span className="font-display text-2xl md:text-3xl">{q}</span>
              <span className={`font-mono text-2xl text-primary transition-transform ${open === i ? "rotate-45" : ""}`}>+</span>
            </button>
            {open === i && <p className="rise max-w-3xl pb-6 text-muted-foreground">{a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="bg-primary px-5 py-24 text-center text-primary-foreground">
      <Tag className="bg-foreground px-2 py-1 text-background">Condição promocional · novembro e dezembro de 2026</Tag>
      <h2 className="mx-auto mt-8 max-w-5xl text-6xl md:text-8xl">Sua loja merece uma nova experiência de venda.</h2>
      <p className="mx-auto mt-6 max-w-xl text-lg">Organize seus produtos, conecte suas vendedoras e deixe seus clientes escolherem como nunca.</p>
      <div className="mt-10"><Btn href={LINKS.signup} variant="dark">QUERO COMEÇAR AGORA</Btn></div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-foreground px-5 py-10 text-background">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 md:flex-row md:items-end">
        <img src={logoV.url} alt="ShopVax" width={2000} height={1833} loading="lazy" className="h-32 w-auto" />
        <Tag className="text-background/60">shopvax.com.br · © 2026</Tag>
      </div>
    </footer>
  );
}

function Index() {
  return (
    <main>
      <Intro />
      <Nav />
      <Hero />
      <Experience />
      <HowItWorks />
      <Features />
      <NoCommission />
      <Plans />
      <Buyers />
      <Partners />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}
