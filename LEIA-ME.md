# Fin Controller — como publicar no GitHub Pages

Este pacote contém tudo que é preciso para colocar o app no ar, direto do
celular Android, usando uma conta GitHub própria.

## Arquivos incluídos
- `index.html` — o app
- `style.css` — visual
- `app.js` — lógica e armazenamento (IndexedDB, os dados ficam salvos no
  próprio aparelho)
- `manifest.json` — configuração de instalação como PWA
- `sw.js` — permite o app funcionar offline
- `icon-192.png` e `icon-512.png` — ícone do app

A conta GitHub já existe: [github.com/julianaTalliatel](https://github.com/julianaTalliatel).
Basta logar nela e seguir a partir do passo 2.

## Passo a passo

1. **Login no GitHub** com a conta [julianaTalliatel](https://github.com/julianaTalliatel).

2. **Criar um repositório novo**
   - No canto superior direito, clique em **+** → **New repository**
   - Nome sugerido: `fin-controller`
   - Marque como **Public**
   - Clique em **Create repository**

3. **Enviar os arquivos**
   - Na página do repositório recém-criado, clique em **uploading an existing file**
   - Arraste todos os arquivos deste pacote (`index.html`, `style.css`, `app.js`,
     `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`)
   - Clique em **Commit changes**

4. **Ativar o GitHub Pages**
   - Vá em **Settings** (na barra do repositório) → **Pages** (menu lateral esquerdo)
   - Em **Branch**, selecione `main` e a pasta `/ (root)`
   - Clique em **Save**
   - Aguarde 1–2 minutos. O link vai aparecer no topo dessa mesma página,
     algo como:
     `https://julianatalliatel.github.io/fin-controller/`

5. **Instalar no Android**
   - Abra esse link no Chrome do celular
   - Toque no menu (⋮) do navegador → **Adicionar à tela inicial** /
     **Instalar app**
   - O ícone da flor vai aparecer na tela inicial, como um app normal

## Sobre os dados
- Tudo fica salvo **no próprio celular** (IndexedDB), não em nenhum servidor.
- Trocar de celular ou desinstalar o app apaga os dados — por isso existe o
  botão **Exportar backup** (menu ⋮ dentro do app), que salva um arquivo
  `.json` que pode ser guardado no Google Drive e restaurado depois pelo
  botão **Importar backup**.

## Sobre atualizações futuras
Qualquer ajuste no app (nova função, correção) pode ser feito aqui e os
arquivos reenviados para o mesmo repositório — é só substituir os arquivos
antigos pelos novos do mesmo jeito do passo 3.
