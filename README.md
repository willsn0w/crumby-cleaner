<p align="center"><img src="renderer/assets/robot.png" width="140" alt="Crumby robot"></p>

# Crumby

> [!NOTE]
> **Versão 1.4 — já está bastante funcional.** O Crumby limpa a área de trabalho de verdade (tudo vai para a Lixeira do Windows), aparece no clique direito da área de trabalho e fica rodando na bandeja do sistema. Ainda pode ter arestas no Windows: se algo sumir, confira a Lixeira.

Um robô aspirador que limpa a sua área de trabalho do Windows de verdade. Ele sai da base, mapeia a tela com um laser, recolhe os ícones um por um e **cada ícone que ele engole vai para a Lixeira do Windows**. Volta para a base quando o compartimento enche, se esvazia e termina com tudo limpo.

**Nada é apagado de vez:** tudo vai para a Lixeira e pode ser restaurado de lá. Antes de começar, o painel mostra quantos itens serão movidos e só começa quando você clica em **Start cleaning**. Atalhos do sistema (Lixeira, Este Computador) ficam onde estão, e arquivos que o Windows não deixa mover (em uso, sem permissão) são "cuspidos" de volta e ficam na área de trabalho.

## Download

Baixe o `Crumby.exe` na página de [Releases](../../releases) (Windows 10/11, 64 bits). Na primeira execução ele leva alguns segundos para se instalar em `%LOCALAPPDATA%\Crumby`; depois abre na hora.

Como o executável não é assinado, o Windows pode mostrar o aviso do SmartScreen: clique em **Mais informações → Executar assim mesmo**.

## Menu do clique direito

Depois de abrir o `Crumby.exe` uma vez, aparece a opção **"Limpar com o Crumby"** ao clicar com o botão direito num espaço vazio da área de trabalho. No Windows 11 ela fica em **Mostrar mais opções** (ou Shift + F10).

O registro é só para o seu usuário (não precisa de administrador). Para remover a opção do menu e a inicialização com o Windows, rode `Crumby.exe --uninstall`.

## Bandeja do sistema

Quando você fecha a janela de limpeza (Esc, Cancel ou a bolinha vermelha), o Crumby continua rodando em plano de fundo, com o ícone dele na bandeja do sistema (perto do relógio; pode estar escondido na setinha **^**).

- **Clique no ícone:** abre uma nova limpeza.
- **Clique direito no ícone:** *Limpar com o Crumby*, *Iniciar com o Windows* (ligado por padrão; ele inicia só na bandeja, sem abrir a limpeza) e *Sair do Crumby*.

## O que ele faz

- **Mapeamento:** feixe de laser varre a tela com som de escaneamento; cada arquivo encontrado dá um "ping" e aparece no minimapa.
- **Limpeza:** o robô vai até cada ícone e o "suga" com um som de aspiração forte; o motor ruge mais alto quando há ícones por perto. O caminho fica desenhado no minimapa.
- **Gravidade:** os ícones perto do robô se esticam, se torcem e tremem na direção dele, são puxados e giram em volta. Alguns ficam inclinados ou de cabeça para baixo e mudam de lugar.
- **Arquivo grande:** para, treme e mostra *Big file. Straining…*
- **Bin cheio:** volta, entra de ré na base e se esvazia (*Self-emptying*), depois retoma.
- **Bateria:** descarrega andando e recarrega na base.
- **Ícones idênticos aos do Windows:** ao começar, o Crumby fotografa a área de trabalho com e sem os ícones e usa o recorte exato de cada um (imagem, tamanho, miniatura, setinha de atalho e nome). Para a foto sair limpa, ele minimiza as janelas abertas ao começar e as restaura ao fechar.
- **A área de trabalho real continua viva:** durante a limpeza, o Crumby cobre a tela com a foto do papel de parede, e os ícones reais do Windows continuam no lugar por baixo (só somem por uma fração de segundo no começo, para a foto). Assim o Windows não perde as posições dos ícones.
- **Arraste arquivos para a área de trabalho com o Crumby aberto:** o Crumby deixa o arrasto passar para o Windows, que recebe o arquivo no lugar exato onde você soltou, e o ícone novo aparece ali na hora.
- **Use os ícones durante a limpeza:** clique para selecionar, duplo clique para abrir, clique direito para *Abrir*, *Mostrar na pasta* ou *Não limpar este item*, e arraste para mudar de lugar. Ao fechar, os ícones reais ficam onde você os deixou. O robô não pega um item que você está segurando ou acabou de selecionar.
- **Interação:** arraste o robô com o mouse, ou arremesse um ícone nele (*Ouch.*).
- **Lixeira de verdade:** cada ícone engolido vai para a Lixeira do Windows na hora; se o Windows recusar, o robô cospe o arquivo de volta (*Can't recycle…*).
- **Confirmação:** antes de começar, o painel mostra quantos itens e quantos GB irão para a Lixeira, com **Start cleaning** e **Cancel**.
- **Base arrastável:** arraste a base para qualquer lugar da tela (ela nunca entra embaixo da barra de tarefas). Se o robô estiver estacionado, vai junto; o Crumby lembra a posição na próxima vez.
- **Plano de fundo:** depois de fechado, fica na bandeja do sistema, pronto para a próxima limpeza.
- **Painel:** status, minimapa, Battery, Bin, itens, GB coletados, tempo, Pause e Stop. O Stop para o robô onde ele está e vira **Resume** para voltar a aspirar. Quando o robô volta para a base no fim, o Pause vira **Start**: ele procura de novo os arquivos da área de trabalho e sai para mais uma rodada.
- **Sons** sintetizados (escaneamento, motor, sucção, bipes, esvaziamento), com botão de mudo.

## Versões

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
| `main.js` | Processo principal do Electron: lê os arquivos do Desktop, pega ícones e posições, abre a camada transparente, move itens para a Lixeira e registra o menu do clique direito |
| `desktop-helper.ps1` | Ajudante do Windows (PowerShell + C#): lê as posições dos ícones e esconde/mostra a camada de ícones |
| `renderer/` | Piso, robô, base, física, máquina de estados, painel e sons |
| `renderer/assets/` | Imagens do robô e da base (SVG + PNG) |
| `launcher/` | Lançador em Go que embute o app num único `Crumby.exe` |
| `scripts/build-win.sh` | Gera `dist/Crumby.exe` |

## Rodar e compilar

```bash
# visualizar a simulação sem instalar nada (dados de exemplo)
open renderer/index.html

# rodar com Electron
npm install
npm start

# gerar dist/Crumby.exe (Linux/macOS; precisa de go, curl, zip, unzip, git)
npm run build:win
```

## Limitações

- Funciona no monitor principal. Ícones em outros monitores não são limpos: somem durante a limpeza e voltam no Esc.
- Itens da área de trabalho pública (`C:\Users\Public\Desktop`) precisam de permissão de administrador para ir para a Lixeira; sem ela, o robô os cospe de volta.
- Se a leitura das posições dos ícones falhar, ele os arruma na grade padrão do Windows.
