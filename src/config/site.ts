export const SITE = {
  name: "Solarium Mantiqueira",
  legalName: "Take Me There",
  cnpj: "42.927.255/0001-44",
  email: "reservas@solariummantiqueira.com",
  whatsappNumber: "5535984075652",
  whatsappDisplay: "+55 35 98407-5652",
  instagram: "solariummantiqueira",
  region: "Serra da Mantiqueira · Brasil",
  pixDiscountPercent: 3,
};

// LOGO assets (Drive file IDs)
export const LOGO = {
  black: "1IZbgrnYYsZi8Z_EUgUvcS8Ve16ZO777w",
  white: "1OV15NPns0IWYMPXZuyiOUEz7PUe5Dr8l",
};

// Hero video — TODO: preencher com fileId do vídeo "headline"/"360 Solarium 1" da pasta landing_page do Drive.
// Enquanto vazio, o HeroVideo cai automaticamente no fallback (foto da banheira).
// Para descobrir o ID: abra o vídeo no Drive, copie o link de compartilhamento, o ID é a string entre /d/ e /view.
export const HERO_VIDEO_FILE_ID = "";

export function whatsappLink(message: string): string {
  return `https://wa.me/${SITE.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

export function instagramLink(handle: string): string {
  return `https://instagram.com/${handle}`;
}

export type Review = {
  id: number;
  author: string;
  from: string;
  date: string;
  property: "solarium-1" | "solarium-2" | "solarium-completo";
  text: string;
  source: "Airbnb" | "Google" | "Booking" | "Direto";
  featured?: boolean;
};

export const REVIEWS: Review[] = [
  { id: 1, author: "Jenifer", from: "Rio de Janeiro", date: "Abril 2022", property: "solarium-1", text: "Não temos palavras para descrever nossa experiência no Solarium Mantiqueira, tudo foi simplesmente perfeito! O Lucas é um dos melhores anfitriões que já conhecemos, atencioso, simpático, responde as mensagens com muita rapidez. A propriedade é simplesmente magnífica, você se sente em casa, o lugar é lindo, a vista é inexplicável.", source: "Airbnb", featured: true },
  { id: 2, author: "Carolina", from: "Rio de Janeiro", date: "Julho 2025", property: "solarium-1", text: "Nossa experiência na cabana foi simplesmente incrível. Desde o momento da reserva, fomos acolhidas com muita atenção e carinho pelo Lucas, que é um anfitrião cuidadoso, prestativo e extremamente gentil. A cabana é linda, acolhedora, bem equipada e limpa — tudo pensado nos mínimos detalhes para proporcionar conforto e bem-estar.", source: "Airbnb", featured: true },
  { id: 3, author: "Luciano", from: "Rio de Janeiro", date: "Março 2026", property: "solarium-1", text: "O que mais nos surpreendeu foi a combinação entre o ambiente campestre e a estrutura tecnológica da casa: tudo muito bem equipado, moderno e funcional, sem abrir mão do aconchego. Uma combinação rara e muito bem executada.", source: "Airbnb", featured: true },
  { id: 4, author: "Vitor", from: "Barueri", date: "Janeiro 2026", property: "solarium-1", text: "O lugar é extremamente lindo! A paisagem é de tirar o fôlego e o ambiente da casa é super aconchegante. Tem um tom de luxo e ao mesmo tempo a natureza junto. O lugar é super privativo, para quem busca algo assim, é muito bom.", source: "Airbnb", featured: true },
  { id: 5, author: "Daniella", from: "São Paulo", date: "Julho 2024", property: "solarium-1", text: "Eu e meu namorado estávamos em busca de um lugar para criarmos memórias incríveis juntos e o Solarium nos proporcionou esse momento. A natureza nos envolve a todo momento. O Lucas é o melhor anfitrião que já tivemos a oportunidade de conhecer.", source: "Airbnb" },
  { id: 6, author: "Priscilla", from: "Brasil", date: "Julho 2024", property: "solarium-1", text: "Encantamento e conforto em total conexão com a natureza: assim podemos descrever nossos quatro dias do Solarium 1. Mesmo estando preparadíssimo para uma estadia romântica, o espaço foi perfeito para nossa família, que puderam brincar com segurança avistando a Serra da Mantiqueira.", source: "Airbnb" },
  { id: 7, author: "Aline", from: "São Lourenço", date: "Outubro 2025", property: "solarium-1", text: "O Lucas é extremamente educado e prestativo. O suporte foi impecável do início ao fim. A acomodação, simplesmente perfeita! Toda automatizada, confortável e linda. Não sentimos falta de absolutamente nada e ainda ficamos surpresos com tantas comodidades.", source: "Airbnb" },
  { id: 8, author: "Letícia", from: "São Bernardo", date: "Janeiro 2025", property: "solarium-1", text: "Local maravilhoso! A casa é extremamente linda e confortável. A região é incrível. Lucas foi um ótimo anfitrião, nos deu ótimas recomendações de restaurantes. Fizemos passeio de quadriciclo em Passa Quatro que é perto e foi perfeito.", source: "Airbnb" },
  { id: 9, author: "Mariana", from: "Rio", date: "Novembro 2024", property: "solarium-2", text: "Nos amamos esses dias: a vista, o clima, tudo da parte interna é perfeito e dá pra ver que foi calculado com muito cuidado e luxo! A TV cinema, a decoração de muitíssimo bom gosto, a piscina, tudo maravilhoso. Foi um sonho.", source: "Airbnb", featured: true },
  { id: 10, author: "Lucas Ferreira", from: "Brasil", date: "2025", property: "solarium-2", text: "O lugar é maravilhoso, de frente com a serra, o sistema de som com a televisão é um verdadeiro cinema! Sem contar a banheira maravilhosa dentro do quarto, simplesmente incrível poder assistir um filme de dentro da banheira.", source: "Google" },
  { id: 11, author: "Roberta", from: "Brasil", date: "2025", property: "solarium-2", text: "Eu e meu esposo fomos comemorar os 10 anos de casamento no Civil no Solarium Mantiqueira. Ficamos hospedados no Mantiqueira 2. O Atendimento, acessória foi maravilhosa.", source: "Google" },
  { id: 12, author: "Erika", from: "Brasil", date: "2025", property: "solarium-completo", text: "Escolhemos o solarium 2 e passamos dias maravilhosos! O lugar é de uma paz e calmaria que todo mundo deveria experimentar, o Lucas desde o primeiro contato foi super paciente e atencioso, sempre disponível e nos atendendo super bem.", source: "Google" },
  { id: 13, author: "Naia", from: "Brasil", date: "2025", property: "solarium-completo", text: "Escolhemos o Solarium Mantiqueira, em Itanhandu, no charmoso sul de Minas Gerais, para comemorar o aniversário do meu amor. Lugar maravilhoso, casa impecável com uma vista espetacular!", source: "Google" },
  { id: 14, author: "Ryan", from: "Barcelona, Espanha", date: "Dezembro 2025", property: "solarium-1", text: "Lucas foi um ótimo anfitrião responsivo e o lugar era mágico. Não poderia pedir uma vista melhor ou uma área circundante mais tranquila. Espero ter a chance de visitar novamente no futuro.", source: "Airbnb" },
  { id: 15, author: "Amund", from: "Internacional", date: "Abril 2025", property: "solarium-1", text: "Este lugar é uma joia no interior do Brasil! Extremamente tranquilo e uma escapadinha perfeita da cidade. Lucas é extremamente atencioso às suas necessidades e um ótimo anfitrião.", source: "Airbnb" },
];

export type Coupon = {
  code: string;
  discount: number;
  type: "percentage" | "fixed";
  minNights: number;
  description: string;
};

export const COUPONS: Coupon[] = [
  { code: "DUASNOITES", discount: 8, type: "percentage", minNights: 2, description: "8% de desconto em estadias de 2+ noites" },
  { code: "EXPERIENCIACOMPLETA", discount: 12, type: "percentage", minNights: 3, description: "12% de desconto em estadias de 3+ noites" },
  { code: "COMEMORACAO", discount: 15, type: "percentage", minNights: 5, description: "15% de desconto em estadias de 5+ noites" },
];

export type CouponValidation =
  | { valid: true; coupon: Coupon; discountAmount: number }
  | { valid: false; reason: string };

export function validateCoupon(code: string, nights: number, subtotal: number): CouponValidation {
  const normalized = code.trim().toUpperCase();
  const coupon = COUPONS.find((c) => c.code === normalized);
  if (!coupon) return { valid: false, reason: "Cupom não encontrado." };
  if (nights < coupon.minNights) {
    return {
      valid: false,
      reason: `Este cupom é válido para estadias de ${coupon.minNights}+ noites.`,
    };
  }
  const discountAmount =
    coupon.type === "percentage" ? subtotal * (coupon.discount / 100) : coupon.discount;
  return { valid: true, coupon, discountAmount };
}

export type Partner = {
  name: string;
  description: string;
  category: string;
  featured?: boolean;
  whatsapp?: string;
  whatsappMessage?: string;
  instagram?: string;
  couponCode?: string;
  couponDescription?: string;
};

export const PARTNERS: Partner[] = [
  {
    name: "Take Me There",
    featured: true,
    description: "Da gestão dos projetos à curadoria de experiências, a Take Me There nos ajuda a trazer soluções inovadoras, serviços de empreendedores locais e atendimento diferenciado.",
    category: "Gestão e Curadoria",
  },
  {
    name: "Cristal Garden",
    description: "A natureza é destaque no que fazemos, e graças aos parceiros da Cristal Garden, conseguimos trazer mais natureza para dentro do ambiente.",
    whatsapp: "5511999999999",
    whatsappMessage: "Olá! Conheci a Cristal Garden pelo Solarium Mantiqueira e gostaria de saber mais.",
    category: "Plantas e Paisagismo",
    instagram: "cristalgarden",
  },
  {
    name: "Vesta Piso Aquecido",
    description: "Sem dúvida a melhor solução de aquecimento disponível no mercado. Materiais de qualidade que garantem uma sensação diferenciada.",
    instagram: "vestapisoaquecido",
    whatsappMessage: "Olá! Conheci a Vesta pelo Solarium Mantiqueira e gostaria de saber mais sobre piso aquecido.",
    category: "Conforto e Aquecimento",
  },
  {
    name: "G3 Hotelaria",
    description: "Pensando em garantir o maior conforto, desenvolvemos uma linha especial junto à G3 Hotelaria. Conforto, luxo e qualidade comprovada.",
    couponCode: "Solarium20",
    couponDescription: "20% de desconto",
    instagram: "g3hotelaria",
    category: "Roupa de Cama e Banho",
  },
  {
    name: "Eco Flame Garden",
    description: "Parceiro alinhado com nosso compromisso de trazer conforto, sofisticação e modernidade. Os puffs se moldam ao seu corpo!",
    whatsapp: "5511913287929",
    whatsappMessage: "Olá, Guida. Estive no Solarium Mantiqueira e gostaria de saber mais informações sobre os produtos da Eco Flame Garden!",
    category: "Mobiliário Outdoor",
  },
  {
    name: "Installer Película Inteligente",
    description: "O melhor dos dois mundos, vista e privacidade. Ao desligar o interruptor ou com Alexa, você terá privacidade total!",
    whatsapp: "5511991098104",
    whatsappMessage: "Olá, Guilherme. Estive no Solarium Mantiqueira e gostaria de saber mais informações da Película Inteligente!",
    category: "Tecnologia e Privacidade",
  },
];

export type ExperienceOnSite = {
  title: string;
  description: string;
  icon: "coffee" | "spa" | "heart";
};

export const EXPERIENCES_ONSITE: ExperienceOnSite[] = [
  {
    title: "Cesta de Café da Manhã",
    description: "Curadoria de produtores locais, entregue diretamente no seu deck no horário marcado.",
    icon: "coffee",
  },
  {
    title: "Sessões de Massagem",
    description: "Profissional parceiro, sessão privativa no conforto da sua estadia. Agendamento prévio.",
    icon: "spa",
  },
  {
    title: "Decoração Especial",
    description: "Aniversários, lua de mel, pedidos. Preparamos o ambiente para o seu momento.",
    icon: "heart",
  },
];

export type RegionExperience = {
  title: string;
  distance?: string;
  description: string;
};

export type RegionCategory = {
  category: string;
  items: RegionExperience[];
};

export const EXPERIENCES_REGION: RegionCategory[] = [
  {
    category: "Aventura",
    items: [
      { title: "Quadriciclo no Rancho Estância Casa Nova", distance: "5 min", description: "Trilhas, cachoeiras e pontos turísticos." },
      { title: "Toca do Lobo Adventure", distance: "40 min", description: "Rotas alternativas a partir de Passa Quatro." },
      { title: "Passeios de Bike", description: "Roteiros adaptados ao seu nível." },
      { title: "Cavalgadas no Rancho Estância Casa Nova", distance: "5 min", description: "Cavalgadas pelas trilhas da região." },
    ],
  },
  {
    category: "Natureza & Cachoeiras",
    items: [
      { title: "Ivos Hostel", distance: "25 min", description: "Trilhas e cachoeiras de águas cristalinas." },
      { title: "Poço Paraíso", distance: "35 min", description: "Águas cristalinas com trilha íngreme no final." },
      { title: "Poço da Encruza", distance: "45 min", description: "Banho refrescante e almoço no Rancho do Zé." },
      { title: "Cachoeira do Andorinhão", distance: "45 min", description: "Poço para nadar, água gelada." },
      { title: "Laurinho — Restaurante e Balneário", distance: "15 min", description: "Fácil acesso, restaurante e poço." },
      { title: "Instituto Alta Montanha", distance: "20 min", description: "Day use, cachoeira e contemplação." },
      { title: "Volta dos 80", description: "Passeio de carro pela estrada de terra." },
      { title: "Cachoeira da Gomeira", distance: "60 min", description: "Visual incrível, trilha curta." },
      { title: "Parque Nacional do Itatiaia", distance: "60 min", description: "Caminhadas de altitude e mirantes." },
      { title: "Capim Amarelo", distance: "1h30", description: "Início da travessia da Serra Fina." },
    ],
  },
  {
    category: "Gastronomia & Rota do Queijo",
    items: [
      { title: "Pérola da Serra", distance: "5 min", description: "Produção 100% de búfala, com visitação." },
      { title: "Di Capre", distance: "25 min", description: "Queijos de cabra e visita ao rebanho." },
      { title: "Queijaria 50", distance: "30 min", description: "Visitação com agendamento." },
      { title: "Almeida Guimarães", distance: "20 min", description: "Queijos de vaca e café à frente da rodovia." },
      { title: "Laticínios Ecila", distance: "20 min", description: "Laticínio tradicional, ampla variedade." },
      { title: "Terra dos Queijos em Alagoa", distance: "2h", description: "Famoso parmesão da região." },
      { title: "Queijaria Garrafão", distance: "2h", description: "Produção tradicional em Alagoa." },
      { title: "Queijaria Santo Antônio", distance: "60 min", description: "Queijos de vaca diferentes do convencional." },
      { title: "Restaurante Encantamonte", distance: "50 min", description: "Excelente opção de almoço." },
    ],
  },
  {
    category: "Histórico & Cultural",
    items: [
      { title: "Maria Fumaça em Passa Quatro", distance: "40 min", description: "Viagem pela Estrada Real, passando pelo Túnel da Mantiqueira." },
    ],
  },
];
