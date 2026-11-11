# Majorelle-ERP
MAJORELLE ERP — versão portátil para Windows (não precisa instalar nada)
========================================================================

COMO USAR
1. Copie esta pasta inteira para o computador (pode ser por pendrive).
2. Dê dois cliques em MajorelleERP.exe.
   - Abre uma janela preta (é o servidor) e o navegador com o sistema.
   - NÃO feche a janela preta enquanto estiver usando. Para encerrar, feche-a.
   - Se o Windows perguntar sobre o Firewall, clique em "Permitir acesso"
     (necessário para usar de outros aparelhos na mesma rede).
3. No PRIMEIRO acesso, o sistema pede para criar o administrador (nome, e-mail e senha).
   Use uma senha forte e guarde-a. O e-mail é o seu login.
4. Para usar de OUTRO aparelho (celular, tablet, outro PC) na mesma rede Wi-Fi, abra no navegador dele o
   endereço "Outros aparelhos" que aparece na janela preta (também em Configurações > Sistema).
   Dica: reserve um IP fixo para este computador no roteador, para o endereço não mudar.

IMPRESSORA TÉRMICA (Configurações > Impressora térmica)
- Impressora USB: instale-a no Windows (driver do fabricante), escolha "Impressora instalada no Windows",
  selecione-a na lista e clique em "Imprimir teste".
- Impressora de rede: escolha "Impressora de rede" e informe o IP (porta 9100).
- Se os acentos saírem trocados, mude a "Página de código" (CP860, CP850 ou "Sem acentos").
- Papel de 80 mm = 48 colunas; de 58 mm = 32 colunas.
- Enquanto está em "Teste", nada é impresso: use "Ver como fica" para ver o cupom na tela.

BACKUP (Configurações > Backup automático)
- Ligado por padrão: a cada 6 horas o sistema guarda uma cópia na pasta data\backups (ao lado do programa),
  mantendo as 20 mais recentes.
- Configure uma "cópia extra" em outra pasta (ex.: pendrive D:\Backups ou pasta do OneDrive).
- Também dá para baixar o backup pela própria tela.
- Guarde cópias FORA deste computador. Um backup no mesmo disco não protege contra defeito do disco.

RESTAURAR UM BACKUP (se precisar)
1. Feche o programa.
2. Abra o Prompt de Comando na pasta do programa e rode:
     MajorelleERP.exe --restaurar "C:\caminho\pizzaria-20261109-120000.db"
   (o banco atual é guardado antes, com o nome antes-da-restauracao-....db, na pasta data)

ESQUECEU A SENHA DO ADMINISTRADOR?
   MajorelleERP.exe --redefinir-senha seu@email.com NovaSenhaForte123

ONDE FICAM OS DADOS
- Pasta "data", ao lado do programa (pizzaria.db, backups e jwt.key). Para levar para outro computador, copie a pasta "data" junto.

CONFIGURAÇÃO OPCIONAL (arquivo .env)
- Copie ".env.example" para ".env" na mesma pasta do programa e edite (porta, chave do n8n, login com Google).

AVISOS
- Usuários: "Administrador" faz tudo; "Atendente" cria e acompanha pedidos mas não altera cardápio, preços,
  configurações nem usuários.
- O sistema usa HTTP (sem criptografia) dentro da sua rede. Use só em Wi-Fi/rede de confiança e não abra a porta
  no roteador para a internet.
- Windows SmartScreen: se aparecer "O Windows protegeu seu PC", clique em "Mais informações" > "Executar assim mesmo"
  (acontece com programas sem assinatura digital).
- Nota fiscal está desativada nesta versão.

