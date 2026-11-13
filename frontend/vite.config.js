import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { lazyAssets, stampSw } from './scripts/sw-stamp.mjs'
import { mobileViewport } from './src/lib/viewport-zoom.js'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'

// A API recusa uma requisição que altera o estado se o navegador a enviou de qualquer lugar 
// que não seja sua própria ORIGIN (a proteção CSRF em api/server.js). O servidor de desenvolvimento 
// fica em uma porta diferente, então a Origin real da página não é a ORIGIN — navegadores modernos 
// passam via Sec-Fetch-Site: same-origin, e apresentar a Origin esperada aqui cobre os que não a enviam. 
// Combine com seu .env se você alterou a ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:8080'

// Mídia de exercícios: servida diretamente de catalogue/media em dev (veja catalogueMedia abaixo), 
// ou roteada para um servidor de sua escolha com MEDIA_TARGET.
const media = process.env.MEDIA_TARGET

const catalogueMedia = {
  name: 'NizuGym-catalogue-media',
  configureServer(server) {
    if (media) return
    const dirs = { '/exercise-media/still/': ['still', '.webp'], '/exercise-media/clip/': ['clip', '.mp4'] }
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../catalogue/media')
    server.middlewares.use((req, res, next) => {
      const prefix = Object.keys(dirs).find(p => req.url.startsWith(p))
      if (!prefix) return next()
      const [dir, ext] = dirs[prefix]
      const name = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
      const file = join(root, dir, name)
      if (!/^\d{4,5}\.(webp|mp4)$/.test(name) || !name.endsWith(ext) || !existsSync(file)) { res.statusCode = 404; return res.end() }
      res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'image/webp')
      res.end(readFileSync(file))
    })
  }
}

// Análise web opcional (Umami). Injetado apenas quando AMBAS as variáveis estão definidas no momento do build,
// então um `npm run build` comum — e toda instalação self-hosted — permanece livre de telemetria.
// Defina para a instância pública: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'NizuGym-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

// O cache do service worker é nomeado de acordo com o build (public/sw.js carrega um placeholder `__BUILD__`):
// um deploy é então um novo worker com seu próprio cache, e a casca e os pedaços do build anterior são 
// descartados na ativação em vez de se acumularem sob um nome fixo. A marcação é um hash do index.html construído — 
// ela muda exatamente quando o bundle muda. O diretório é aquele para o qual este build escreveu 
// (`--outDir` incluído), não um ./dist/ fixo: um build para um outDir privado deixava `__BUILD__` sem marcação em seu sw.js. 
// O worker também recebe o código do build que carrega sob demanda (`__LAZY__`, scripts/sw-stamp.mjs), 
// para que ele esteja lá offline antes mesmo de a página precisar dele.
let outDir = fileURLToPath(new URL('./dist/', import.meta.url))
let lazy = []
const swStamp = {
  name: 'NizuGym-sw-stamp',
  apply: 'build',
  configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
  generateBundle(_, bundle) { lazy = lazyAssets(bundle) },
  closeBundle() {
    const html = join(outDir, 'index.html'), sw = join(outDir, 'sw.js')
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, stampSw(readFileSync(sw, 'utf8'), { stamp, lazy }))
  }
}

// A versão de celular indica isso no seu index.html. Um build web que rodou no mesmo dist/ entre
// o build mobile e o `cap sync` (dois builds em uma árvore de trabalho) enviou a casca web dentro de um
// APK: sem configurações exclusivas do Android, um service worker, o login por passkey. scripts/check-mobile-bundle.mjs
// lê esta tag na cópia sincronizada após o `cap sync` e falha o build se ela não estiver lá.
// A versão de celular também mantém o zoom desativado (src/lib/viewport-zoom.js): o build web permite
// que as pessoas façam pinça, os apps Capacitor permanecem como estavam.
const flavor = {
  name: 'NizuGym-flavor',
  transformIndexHtml(html) {
    if (process.env.VITE_MOBILE !== '1') return
    return { html: mobileViewport(html), tags: [{ tag: 'meta', attrs: { name: 'NizuGym-flavor', content: 'mobile' }, injectTo: 'head' }] }
  }
}

// A versão que as pessoas são solicitadas a informar em #install-help e em cada 
// relatório de bug. Lida do package.json para que não se desvie da versão em que foi construída, 
// e embutida no momento do build para que nenhuma busca em tempo de execução esteja envolvida.
//
// APP_BUILD, quando o build o define, é anexado como "1.3.8+<build>". Um build empacotado carrega uma
// versão que seu package.json não pode saber — toda imagem construída entre dois lançamentos relata o mesmo
// número, então a pergunta que um relatório de bug faz, "qual build você estava rodando?", não tinha
// resposta de dentro do app. Indefinido (o caso comum, e todo build upstream) não muda
// nada: a string é exatamente a versão do package.json.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appVersion = process.env.APP_BUILD ? `${pkgVersion}+${process.env.APP_BUILD}` : pkgVersion

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), umami, flavor, swStamp, catalogueMedia],
  base: './',
  server: {
    // <-- ADICIONADO AQUI: Força o servidor a rodar na porta 8080 para bater com a API -->
    port: 8080,
    
    // O núcleo do Coach (payload, validador, prompts, adaptadores HTTP) fica em ../api/coach/core
    // e é importado pelo build do celular. vite build e vitest já o alcançam; o servidor de dev
    // precisa ser informado de que o workspace é mais amplo que frontend/.
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      ...(media ? {
        '/exercise-media': { target: media, changeOrigin: true }
      } : {})
    }
  },
  // A meta de implantação do app iOS é 15.5 (ios/App), então sua WebView é Safari 15.5, e o app web
  // segue o mesmo piso. O padrão do próprio Vite é Safari 16.4: sintaxe mais nova que 15.5 saía
  // sem rebaixamento e um regex lookbehind manteve a 1.4.2 na tela de abertura lá. O que o transpilador não consegue
  // rebaixar, scripts/check-bundle-syntax.mjs captura (seu teste constrói o bundle).
  build: { chunkSizeWarningLimit: 1500, target: ['safari15', 'chrome100', 'firefox100', 'edge100'] },
  // Dá aos testes happy-dom um localStorage funcional no Node 24+ (#733).
  test: { setupFiles: ['./src/test-setup.js'] }
})
