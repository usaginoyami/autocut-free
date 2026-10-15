# AutoCut Free

Painel **gratuito** para o **Adobe Premiere Pro** que corta silêncios, encontra highlights de gameplay,
gera legendas com Whisper (local) e aplica zoom automático. Feito para uso pessoal, 100% offline.

> Projeto independente, sem relação com plugins pagos de nome parecido. Sem garantias (veja a licença).

## O que faz

- **Cortar silêncios**: remove pausas com limiar automático (mede o volume do vídeo) ou manual.
- **Highlights de gameplay**: pega os momentos mais altos do áudio, com tempo antes/depois configurável.
- **Mantém todas as faixas de áudio** do arquivo (ex.: mistura, microfone, jogo), cada uma na sua trilha.
- **Legendas** com [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (só transcreve os trechos mantidos); gera um `.srt` e tenta aplicar na sequência.
- **Zoom automático**: alterna a Escala (Movimento) entre 100% e X% (padrão 112%) a cada corte.
- Gera uma **sequência nova** `<video>_autocut` no projeto. O vídeo original não é alterado.

## Requisitos

- Windows + Adobe Premiere Pro 2022 ou mais novo (testado no Premiere 26.0 em português)
- [FFmpeg](https://ffmpeg.org) no PATH (`winget install Gyan.FFmpeg`)
- Python 3.12 (o instalador cuida disso, só para o Whisper)

## Instalação

1. Baixe/clone este repositório.
2. Dê dois cliques em **`install.bat`**. Ele:
   - copia o painel para `%APPDATA%\Adobe\CEP\extensions\AutoCutFree`;
   - ativa extensões não assinadas (`PlayerDebugMode`) para `CSXS.9` a `CSXS.12` na sua conta;
   - instala o Python 3.12 (via `winget`, se faltar) e o `faster-whisper`.
3. Reinicie o Premiere e abra **Janela > Extensões > AutoCut Free**.

Para desinstalar: apague a pasta `%APPDATA%\Adobe\CEP\extensions\AutoCutFree`.

## Uso

1. Escolha o vídeo (**Abrir**) ou use **Usar clipe selecionado na timeline**.
2. Escolha o modo e a **faixa de áudio** (0 = primeira). Para cortar silêncio e legendar, use a faixa do **microfone**.
3. Marque zoom e/ou legendas e clique em **Cortar e importar**.

### Linha de comando (sem o Premiere)

O motor é um script único em Python e gera um XML (FCP7/xmeml) que o Premiere importa:

```
python extension/autocut_free.py video.mp4 --mode silence --track 1 --captions
python extension/autocut_free.py gameplay.mp4 --mode highlights --top 12 --before 6 --after 4
```

Opções: `--noise auto|-35`, `--min-silence 0.4`, `--pad 0.08`, `--track N`, `--captions`, `--model small`,
`--lang pt`, `--device cpu|cuda`.

## Limitações conhecidas

- O painel cria uma sequência nova; não corta uma sequência que você já editou.
- O highlights usa só volume do áudio (não analisa a imagem).
- O zoom é fixo e centralizado (sem rastrear rosto/ação).
- Aplicar legendas por script depende da versão do Premiere; se falhar, arraste o `.srt` para a timeline.
- Whisper roda na CPU por padrão (`--device cuda` exige as bibliotecas CUDA instaladas).
- O instalador é só para Windows.

## Licença

[MIT](LICENSE)
