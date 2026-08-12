# ND Lanches — Cardápio Digital

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-F7DF1E?logo=javascript&logoColor=111827)
![API](https://img.shields.io/badge/API-Spring_Boot-6DB33F?logo=springboot&logoColor=white)

Frontend de um cardápio digital para lanchonetes, integrado a uma API própria em Spring Boot. O projeto possui uma experiência pública para clientes e uma área administrativa separada.

> **Status:** projeto de portfólio em evolução.

## Funcionalidades

- visualização do cardápio;
- organização de produtos e adicionais;
- banners e informações da loja;
- fluxo de pedidos;
- painel administrativo;
- integração com a API ND Lanches;
- geração de arquivos minificados com esbuild.

## Integração

Este frontend consome a API disponível em [arthur-amancio/Nd-Lanches-API](https://github.com/arthur-amancio/Nd-Lanches-API).

## Como executar

~~~bash
git clone https://github.com/arthur-amancio/NdLanches.git
cd NdLanches
npm install
python -m http.server 5500
~~~

Configure a URL da API para o seu ambiente e acesse http://localhost:5500.

## Estrutura principal

~~~text
NdLanches/
├── index.html
├── admin.html
├── app.js
├── appAdmin.js
├── style.css
├── styleAdmin.css
└── package.json
~~~

## Boas práticas

- não versionar node_modules;
- não publicar chaves administrativas;
- usar variáveis de ambiente na API;
- manter frontend e API documentados em conjunto.

## Autor

Desenvolvido por [Arthur Amancio Francisco](https://www.linkedin.com/in/arthur-amancio-francisco/) como projeto de estudo e portfólio.
