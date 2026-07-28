from PIL import Image
import os

def fatiar_sprite(nome_ficheiro, numero_de_quadros):
    # Dizemos ao script que os ficheiros estão na pasta "BVA2"
    caminho_ficheiro = os.path.join("BVA2", nome_ficheiro)
    
    try:
        img = Image.open(caminho_ficheiro)
        largura_total, altura_total = img.size
        
        # Calcula a largura de cada quadro
        largura_frame = largura_total // numero_de_quadros
        
        # Cria uma pasta com o nome da animação DENTRO da pasta BVA2
        nome_pasta = os.path.join("BVA2", nome_ficheiro.replace(".png", ""))
        if not os.path.exists(nome_pasta):
            os.makedirs(nome_pasta)

        print(f"A processar '{nome_ficheiro}' ({numero_de_quadros} frame(s))...")

        # Corta e guarda cada quadro
        for i in range(numero_de_quadros):
            esquerda = i * largura_frame
            direita = esquerda + largura_frame
            
            # Recorta (Esquerda, Cima, Direita, Baixo)
            frame = img.crop((esquerda, 0, direita, altura_total))
            
            # Guarda o ficheiro dentro da nova pasta
            caminho_guardar = os.path.join(nome_pasta, f"{nome_ficheiro.replace('.png', '')}_{i+1}.png")
            frame.save(caminho_guardar)
            
    except FileNotFoundError:
        print(f"Erro: Não encontrei a imagem '{caminho_ficheiro}'. Certifica-te que o nome está correto e dentro da pasta BVA2.")

print("--- A INICIAR O CORTE DE SPRITES ---\n")

# --- ANIMAÇÕES DO JOGADOR ---
fatiar_sprite("playerIdle.png", 12)
fatiar_sprite("playerRun.png", 12)
fatiar_sprite("playerSlide.png", 16)
fatiar_sprite("playerSmash.png", 14)
fatiar_sprite("playerReception.png", 11)
fatiar_sprite("playerBlock.png", 14)

# --- ANIMAÇÕES DA BOLA ---
fatiar_sprite("ballBounce.png", 12)
fatiar_sprite("ballBounceHard.png", 23)
fatiar_sprite("ballFull.png", 47)
fatiar_sprite("ballRoll.png", 8)
fatiar_sprite("ballShot.png", 10)

# --- OUTRAS ANIMAÇÕES / UI ---
fatiar_sprite("net0.png", 6)
fatiar_sprite("pushbutton.png", 5)

# --- IMAGENS ESTÁTICAS (1 FRAME) ---
fatiar_sprite("beachbkgIso.png", 1)
fatiar_sprite("beachbkgO.png", 1)
fatiar_sprite("bubbleOK.png", 1)
fatiar_sprite("shadow1.png", 1)

print("\n--- CONCLUÍDO! Tudo cortado e organizado nas respetivas pastas dentro da BV2. ---")