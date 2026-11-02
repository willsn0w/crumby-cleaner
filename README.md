<p align="center"><img src="renderer/assets/robot.png" width="140" alt="Crumb robot"></p>

# Crumb

> [!WARNING]
> **Versão 1.0 (alpha) — ainda não está funcionando.** Este projeto está em desenvolvimento e o executável ainda não funciona corretamente no Windows. Use por sua conta e risco.

Um robô aspirador que limpa a sua área de trabalho do Windows. Ele sai da base, mapeia a tela com um laser, recolhe os ícones um por um, volta para a base quando o compartimento enche, se esvazia e termina com tudo limpo.

**Nenhum arquivo é movido ou apagado.** Os ícones reais só ficam escondidos enquanto o Crumb roda. Esc (ou a bolinha vermelha do painel) fecha o app e traz a área de trabalho de volta, mesmo se o app travar.

## Download

Baixe o `Crumb.exe` na página de [Releases](../../releases) (Windows 10/11, 64 bits). Na primeira execução ele leva alguns segundos para se instalar em `%LOCALAPPDATA%\Crumb`; depois abre na hora.

Como o executável não é assinado, o Windows pode mostrar o aviso do SmartScreen: clique em **Mais informações → Executar assim mesmo**.

## O que ele faz

- **Mapeamento:** feixe de laser varre a tela e os arquivos aparecem no minimapa.
- **Limpeza:** o robô vai até cada ícone e o "suga"; o caminho fica desenhado no minimapa.
- **Arquivo grande:** para, treme e mostra *Big file. Straining…*
- **Bin cheio:** volta, entra de ré na base e se esvazia (*Self-emptying*), depois retoma.
- **Bateria:** descarrega andando e recarrega na base.
- **Interação:** arraste o robô com o mouse, ou arremesse um ícone nele (*Ouch.*).
- **Painel:** status, minimapa, Battery, Bin, itens, GB coletados, tempo, Pause e Stop.
- **Sons** sintetizados (motor, sucção, bipes), com botão de mudo.

## Estrutura

| Caminho | O que é |
|---|---|
| `main.js` | Processo principal do Electron: lê os arquivos do Desktop, pega ícones e posições, abre a camada transparente |
| `desktop-helper.ps1` | Ajudante do Windows (PowerShell + C#): lê as posições dos ícones e esconde/mostra a camada de ícones |
| `renderer/` | Piso, robô, base, física, máquina de estados, painel e sons |
| `renderer/assets/` | Imagens do robô e da base (SVG + PNG) |
| `launcher/` | Lançador em Go que embute o app num único `Crumb.exe` |
| `scripts/build-win.sh` | Gera `dist/Crumb.exe` |

## Rodar e compilar

```bash
# visualizar a simulação sem instalar nada (dados de exemplo)
open renderer/index.html

# rodar com Electron
npm install
npm start

# gerar dist/Crumb.exe (Linux/macOS; precisa de go, curl, zip, unzip, git)
npm run build:win
```

## Limitações

- Funciona no monitor principal. Ícones em outros monitores somem durante a limpeza e voltam no Esc.
- Se a leitura das posições dos ícones falhar, ele os arruma na grade padrão do Windows.
