<p align="center"><img src="renderer/assets/robot.png" width="140" alt="Crumby robot"></p>

# Crumby

> [!NOTE]
> **Versão 1.5.4 — já está bastante funcional, e testada num Windows 11 de verdade.** O Crumby agora vive na sua área de trabalho como um bichinho de estimação (no estilo Desktop Goose e Shimeji): a área de trabalho do Windows continua funcionando normalmente por baixo dele, e tudo o que ele engole vai para a Lixeira.

Um robô aspirador que limpa a sua área de trabalho do Windows de verdade. Ele sai da base, mapeia a tela com um laser, vai até os ícones um por um e **cada ícone que ele engole vai para a Lixeira do Windows**. Volta para a base quando o compartimento enche, se esvazia e termina com tudo limpo.

**Nada é apagado de vez:** tudo vai para a Lixeira e pode ser restaurado de lá. Antes de começar, o painel mostra quantos itens serão movidos e só começa quando você clica em **Start cleaning**. Atalhos do sistema (Lixeira, Este Computador) e o próprio Crumby ficam onde estão, e arquivos que o Windows não deixa mover (em uso, sem permissão) são "cuspidos" de volta.

## Como funciona (modelo "mascote")

O Crumby não imita a área de trabalho: ele é uma janela transparente por cima dela que **deixa o mouse passar em todo lugar**, menos no robô, na base e no painel.

- **A área de trabalho é a de sempre:** você seleciona, abre, renomeia, usa o clique direito e arrasta arquivos de outras janelas para a área de trabalho normalmente, com o Crumby aberto.
- **O robô enxerga os ícones reais:** ele lê a posição de cada ícone várias vezes por segundo. Arquivo novo ou ícone arrastado, ele percebe na hora.
- **Gravidade de verdade:** os ícones reais perto do robô são puxados e tremem. Nada se mexe enquanto você está arrastando algo, e o ícone que você está segurando é deixado em paz.
- **A sucção:** quando o robô engole um ícone, ele fotografa só aquele ícone, recorta usando uma foto do papel de parede tirada no começo e anima o recorte entrando no robô (cerca de 1 segundo por item). Enquanto a Lixeira trabalha, um pedaço do papel de parede cobre o ícone real até o Windows tirá-lo.
- **Aparece em prints e gravações de tela:** o Crumby só some das capturas nos milissegundos em que fotografa um ícone.

## Download

Baixe o `Crumby.exe` na página de [Releases](../../releases) ou em **Actions → Build Crumby.exe** (Windows 10/11, 64 bits). Na primeira execução ele leva alguns segundos para se instalar em `%LOCALAPPDATA%\Crumby`; depois abre na hora.

Como o executável não é assinado, o Windows pode mostrar o aviso do SmartScreen: clique em **Mais informações → Executar assim mesmo**.

## Menu do clique direito

Depois de abrir o `Crumby.exe` uma vez, aparece a opção **"Limpar com o Crumby"** ao clicar com o botão direito num espaço vazio da área de trabalho. No Windows 11 ela fica em **Mostrar mais opções** (ou Shift + F10).

O registro é só para o seu usuário (não precisa de administrador). Para remover a opção do menu e a inicialização com o Windows, rode `Crumby.exe --uninstall`.

## Bandeja do sistema

Quando você fecha o Crumby (Esc, Cancel ou a bolinha vermelha), ele continua rodando em plano de fundo, com o ícone dele na bandeja do sistema (perto do relógio; pode estar escondido na setinha **^**).

- **Clique no ícone:** mostra o Crumby de novo.
- **Clique direito no ícone:** *Limpar com o Crumby*, *Iniciar com o Windows* (ligado por padrão; ele inicia só na bandeja) e *Sair do Crumby*.

## O que ele faz

- **Mapeamento:** feixe de laser varre a tela com som de escaneamento; cada ícone encontrado brilha, dá um "ping" e aparece no minimapa.
- **Limpeza:** o robô vai até cada ícone e o suga com som de aspiração forte; o motor ruge mais alto quando há ícones por perto. O caminho fica desenhado no minimapa.
- **Arquivo grande:** para, treme e mostra *Big file. Straining…*
- **Bin cheio:** volta, entra de ré na base e se esvazia (*Self-emptying*), depois retoma.
- **Bateria:** descarrega andando e recarrega na base.
- **Confirmação:** antes de começar, o painel mostra quantos itens e quantos MB/GB irão para a Lixeira, com **Start cleaning** e **Cancel**.
- **Base e robô arrastáveis:** arraste a base para qualquer lugar (nunca embaixo da barra de tarefas; a posição é lembrada) e pegue o robô no colo.
- **Painel:** status, minimapa, Battery, Bin, itens, tamanho coletado, tempo, Pause e Stop. O Stop para o robô onde ele está e vira **Resume**. Quando o robô volta para a base no fim, o Pause vira **Start** para mais uma rodada.
- **Sons** sintetizados (escaneamento, motor, sucção, bipes, esvaziamento), com botão de mudo.

## Versões

### 1.5.4
- O botão **Start cleaning** nunca fica bloqueado: mesmo sem nada para limpar (só a Lixeira ou o próprio Crumby na área de trabalho), o robô sai, faz a varredura e volta para a base. O painel avisa que a área de trabalho já parece limpa.

### 1.5.3
- Corrigido: depois de um ciclo completo, arrastar a base ou o robô deixava um tracinho azul no minimapa (o rastro da última rodada, que antes ficava escondido embaixo do robô). Agora o rastro antigo é apagado quando o robô ou a base são movidos com o ciclo já terminado.
- Ligar ou desligar o modo de teste (arquivo `test-mode`) reinicia o Crumby sozinho.

### 1.5.2
- Corrigido: uma travadinha depois de cada sucção. O Crumby agora fotografa os próximos ícones com antecedência, enquanto o robô ainda está longe, e o robô não para mais esperando a foto (medido no Windows: 1–3 ms por ícone, nenhum quadro travado durante a limpeza).
- Corrigido: todos os ícones piscavam ao clicar em **Start**. Durante a foto do papel de parede, o Crumby cobre a tela com uma foto idêntica dela mesma, então nada pisca.
- Corrigido: tela preta por uns 2 segundos ao abrir o Crumby. A janela só aparece depois de desenhar o primeiro quadro.
- O atalho `Crumby.exe` da área de trabalho abre sempre o Crumby instalado mais novo.

### 1.5.1
- Corrigido: depois da primeira limpeza, um arquivo novo solto na área de trabalho não era limpo ao clicar em **Start** (o robô saía e voltava). O Windows deixa o arquivo solto selecionado, e o robô ignorava ícones selecionados; agora ele só deixa em paz o ícone que você está segurando com o mouse.
- Corrigido: ao arrastar a base depois da limpeza, aparecia uma linha azul no minimapa. O rastro do robô agora se interrompe quando ele é carregado (com a base ou no colo), em vez de traçar uma reta.

### 1.5
- **Novo modelo "mascote":** a área de trabalho real fica sempre na frente e funcionando; o Crumby desenha só o robô, a base e o painel e deixa o mouse passar no resto. Dá para arrastar arquivos para a área de trabalho, selecionar, abrir e renomear com o Crumby aberto.
- **Corrigido um erro antigo que quebrava tudo no Windows:** o ajudante que lê os ícones não compilava desde a 1.3.2 (o PowerShell recusava uma linha), então o Crumby não enxergava os ícones de verdade. Era a causa de boa parte dos bugs das versões 1.3.2 e 1.4.
- **Corrigido:** janela cinza em vez de transparente em alguns Windows.
- A gravidade agora move os ícones reais; a sucção fotografa só o ícone engolido e leva cerca de 1 segundo por item.
- O Crumby pede ao Windows para atualizar a área de trabalho (F5) no começo e no fim, para não sobrar ícone de arquivo que já foi para a Lixeira.
- O Crumby não tenta mais se jogar na Lixeira, e aparece normalmente em prints e gravações de tela.
- O painel foi para o canto inferior direito, fora da coluna de ícones do Windows.
- Saíram: as janelas minimizadas no começo, o menu próprio dos ícones (agora vale o do Windows), e a distorção forte de todos os ícones em volta do robô (agora só o ícone engolido se contorce).
- Testado num Windows 11 em espanhol, com área de trabalho no OneDrive e tela com escala de 125%.

### 1.4
- Corrigido: não dava para arrastar arquivos novos para a área de trabalho com o Crumby aberto. Agora o Windows recebe o arquivo onde você soltou e o Crumby mostra o ícone novo no mesmo lugar.
- Corrigido: depois de fechar o Crumby, arquivos arrastados para a área de trabalho iam parar no canto superior esquerdo. Os ícones reais não ficam mais escondidos durante a limpeza; o Crumby mostra uma foto do papel de parede por cima.
- Antes de um arquivo cair na área de trabalho, os ícones reais vão para onde você os deixou no Crumby, para nada ser solto dentro da pasta errada.

### 1.3.2
- Corrigido: os ícones mudavam de tamanho, de imagem e de nome durante a limpeza. Agora são cópias exatas dos ícones do Windows.
- Corrigido: não dava para mexer nos ícones enquanto o Crumby limpava. Agora dá para selecionar, abrir, usar o clique direito e arrastar, e a posição nova vai para a área de trabalho de verdade.
- As janelas abertas são minimizadas no começo da limpeza e restauradas no fim.

### 1.3.1
- Depois que o robô volta para a base, o botão Pause vira **▶ Start** para rodar de novo, já pegando arquivos salvos depois da última limpeza.

### 1.3
- Já está bastante funcional.
- Opção do clique direito renomeada para **"Limpar com o Crumby"**.
- Base arrastável para qualquer lugar da tela, respeitando a barra de tarefas, com a posição lembrada entre usos.
- Crumby fica rodando em plano de fundo na bandeja do sistema depois de fechado, com menu (*Limpar com o Crumby*, *Iniciar com o Windows*, *Sair do Crumby*).
- Abrir de novo (pelo `.exe` ou pelo clique direito) reaproveita o Crumby que já está rodando.

### 1.2 (alpha)
- Limpeza de verdade: os arquivos e pastas da área de trabalho vão para a Lixeira do Windows conforme o robô os engole.
- Tela de confirmação antes de começar (**Start cleaning** / **Cancel**).
- Opção **"Limpar a área de trabalho com Crumby"** no menu do clique direito da área de trabalho; `Crumby.exe --uninstall` remove.
- Arquivos que o Windows não deixa mover são cuspidos de volta; atalhos do sistema ficam no lugar.

### 1.1 (alpha)
- Projeto renomeado para **Crumby** (app, painel, base, `Crumby.exe` e pasta de instalação).
- Som durante o escaneamento a laser, com "ping" a cada arquivo encontrado.
- Aspiração mais forte quando o robô passa em cima de um ícone, e motor que reage aos ícones por perto.
- Ícones se distorcem, se contorcem e são puxados pela força do aspirador; alguns viram de cabeça para baixo ou mudam de lugar.
- Botão Stop corrigido: o robô para no lugar e o botão vira **Resume** para continuar a limpeza.

### 1.0 (alpha)
- Primeira versão: mapeamento, limpeza, arquivo grande, volta à base, esvaziamento, bateria, painel, arrastar o robô e arremessar ícones.

## Estrutura

| Caminho | O que é |
|---|---|
| `main.js` | Processo principal: lê os ícones reais, move os ícones (gravidade), fotografa e recorta o ícone engolido, Lixeira, menu do clique direito e bandeja |
| `desktop-helper.ps1` | Ajudante do Windows (PowerShell + C#): posições e seleção dos ícones, mover ícones, fotografar um pedaço da tela, F5 |
| `renderer/` | Robô, base, laser, física, máquina de estados, painel e sons |
| `renderer/assets/` | Imagens do robô e da base (SVG + PNG) |
| `launcher/` | Lançador em Go que embute o app num único `Crumby.exe` |
| `desktop-shortcut/` | `Crumby.exe` pequeno (2 MB) que abre o Crumby já instalado |
| `scripts/build-win.sh` | Gera `dist/Crumby.exe` |

## Rodar e compilar

```bash
# visualizar a simulação sem instalar nada (ícones de exemplo)
open renderer/index.html

# rodar com Electron
npm install
npm start

# gerar dist/Crumby.exe (Linux/macOS; precisa de go, curl, zip, unzip, git)
npm run build:win
```

**Modo de teste:** crie um arquivo `test-mode` com o texto `on` ao lado do `main.js` instalado (`%LOCALAPPDATA%\Crumby\<versão>\resources\app`). Nesse modo o Crumby só limpa arquivos chamados `crumby-test…`, grava um `debug.log` e se reinicia sozinho quando os arquivos dele mudam. Trocar o texto para `off` volta ao modo normal (o Crumby se reinicia sozinho).

## Limitações

- Funciona no monitor principal; ícones em outros monitores são ignorados.
- Com **Organizar ícones automaticamente** ligado no Windows, a gravidade não consegue mover os ícones (o Windows os devolve para a grade).
- Itens da área de trabalho pública (`C:\Users\Public\Desktop`) precisam de permissão de administrador para ir para a Lixeira; sem ela, o robô os cospe de volta.
- Se você trocar o papel de parede no meio de uma limpeza, os recortes podem sair com um contorno do papel antigo até a próxima rodada.
