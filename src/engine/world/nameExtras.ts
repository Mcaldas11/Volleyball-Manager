/**
 * More names for the naming traditions the world draws on most, so a league
 * stops reading as the same twenty-six surnames. Each list continues its bank
 * in names.ts, the most common names there first and these after them, rarer:
 * a surname is drawn with a weight that falls with its place (see
 * `drawSurname`), so the García and Silva stay common without filling a squad.
 */

export interface NameExtra {
  first?: readonly string[];
  last?: readonly string[];
  /** Women's first names, in the women's game. */
  womenFirst?: readonly string[];
}

const SPANISH_LAST = [
  'Serrano', 'Blanco', 'Molina', 'Morales', 'Suárez', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz',
  'Iglesias', 'Núñez', 'Medina', 'Garrido', 'Cortés', 'Castillo', 'Santos', 'Lozano', 'Guerrero', 'Cano', 'Prieto',
  'Méndez', 'Cruz', 'Calvo', 'Gallego', 'Vidal', 'León', 'Márquez', 'Herrera', 'Peña', 'Flores', 'Cabrera', 'Campos',
  'Vega', 'Fuentes', 'Carrasco', 'Díez', 'Caballero', 'Reyes', 'Nieto', 'Aguilar', 'Pascual', 'Santana', 'Herrero',
  'Lorenzo', 'Montero', 'Hidalgo', 'Giménez', 'Ibáñez', 'Ferrer', 'Durán', 'Santiago', 'Benítez', 'Mora', 'Vicente',
  'Vargas', 'Arias', 'Carmona', 'Crespo', 'Román', 'Pastor', 'Soto', 'Sáez', 'Velasco', 'Moya', 'Soler', 'Parra',
  'Esteban', 'Bravo', 'Gallardo', 'Rojas', 'Pardo', 'Merino', 'Franco', 'Espinosa', 'Izquierdo', 'Lara', 'Rivas',
  'Rivera', 'Casado', 'Arroyo', 'Redondo', 'Camacho', 'Rey', 'Vera', 'Otero', 'Luque', 'Galán', 'Montes', 'Ríos',
  'Sierra', 'Segura', 'Carrillo', 'Marcos', 'Soriano', 'Mendoza', 'Robles', 'Bermúdez', 'Aranda', 'Echevarría',
  'Etxeberria', 'Aguirre', 'Goikoetxea', 'Zubizarreta', 'Puig', 'Vilaró', 'Casals', 'Ferrán', 'Salinas', 'Quintana',
  'Valero', 'Beltrán', 'Miranda', 'Toledo', 'Escudero', 'Andrés', 'Mesa', 'Bueno', 'Mateo', 'Barrios', 'Avilés',
];

export const NAME_EXTRAS: Readonly<Record<string, NameExtra>> = {
  spanish: {
    first: ['Juan', 'Antonio', 'José', 'Francisco', 'Luis', 'Alejandro', 'David', 'Mario', 'Víctor', 'Hugo', 'Martín',
      'Lucas', 'Nicolás', 'Samuel', 'Mateo', 'Enrique', 'Jaime', 'Guillermo', 'Roberto', 'Ricardo', 'Eduardo', 'Joaquín',
      'Ramón', 'Vicente', 'Íker', 'Unai', 'Aitor', 'Asier', 'Jon', 'Xabier', 'Pau', 'Jordi', 'Marc', 'Arnau', 'Oriol',
      'Borja', 'Rodrigo', 'Gabriel', 'Bruno', 'Tomás', 'Agustín', 'Felipe', 'Alfonso', 'Santiago', 'Julián', 'Íñigo', 'Gorka'],
    last: SPANISH_LAST,
    womenFirst: ['Carmen', 'Isabel', 'Rocío', 'Beatriz', 'Silvia', 'Lorena', 'Miriam', 'Natalia', 'Sonia', 'Teresa',
      'Pilar', 'Inés', 'Leire', 'Ane', 'Itziar', 'Maialen', 'Laia', 'Núria', 'Montserrat', 'Aitana', 'Noa', 'Valeria',
      'Daniela', 'Sofía', 'Celia', 'Rebeca', 'Eva', 'Esther', 'Alicia', 'Belén', 'Ángela', 'Lidia', 'Olga', 'Emma'],
  },
  argentine: {
    first: ['Juan', 'Facundo', 'Nicolás', 'Lucas', 'Matías', 'Agustín', 'Santiago', 'Tomás', 'Franco', 'Ezequiel',
      'Federico', 'Gonzalo', 'Joaquín', 'Lautaro', 'Maximiliano', 'Leandro', 'Emiliano', 'Bruno', 'Thiago', 'Valentín',
      'Ignacio', 'Martín', 'Germán', 'Cristian', 'Rodrigo', 'Luciano', 'Gastón', 'Pablo', 'Sebastián', 'Diego'],
    last: ['Gutiérrez', 'Molina', 'Castro', 'Ortiz', 'Silva', 'Núñez', 'Luna', 'Juárez', 'Cabrera', 'Ríos', 'Morales',
      'Godoy', 'Moreno', 'Ferreyra', 'Domínguez', 'Carrizo', 'Peralta', 'Castillo', 'Ledesma', 'Quiroga', 'Vega', 'Vera',
      'Muñoz', 'Ojeda', 'Ponce', 'Villalba', 'Cardozo', 'Navarro', 'Coronel', 'Vázquez', 'Ramos', 'Vargas', 'Cáceres',
      'Arias', 'Figueroa', 'Córdoba', 'Correa', 'Maldonado', 'Paz', 'Rivero', 'Miranda', 'Mansilla', 'Farías', 'Roldán',
      'Méndez', 'Guzmán', 'Agüero', 'Hernández', 'Lucero', 'Cruz', 'Páez', 'Escobar', 'Mendoza', 'Barrios', 'Bustos',
      'Ávila', 'Ayala', 'Blanco', 'Soria', 'Maidana', 'Acuña', 'Leiva', 'Moyano', 'Campos', 'Peña', 'Rojas', 'Aguilera',
      'Gallardo', 'Montenegro', 'Bianchi', 'Russo', 'Lombardi', 'Bruno', 'Castelli', 'Pratto', 'Solé', 'Zanotti', 'Bertolotti'],
  },
  cuban: {
    first: ['Yoandy', 'Yosvany', 'Osmany', 'Yordan', 'Leonel', 'Ángel', 'Javier', 'Michael', 'Raydel', 'Yonder', 'Reinier',
      'Liván', 'Yasser', 'Dariel', 'Adrián', 'Julio', 'Rolando', 'Wilfredo', 'Ernesto', 'Alexis', 'Lázaro', 'Yuniel', 'Arlan'],
    last: ['Castro', 'Fernández', 'López', 'Morales', 'Torres', 'Álvarez', 'Ruiz', 'Jiménez', 'Delgado', 'Suárez', 'Reyes',
      'Cruz', 'Gómez', 'Romero', 'Vázquez', 'Ortiz', 'Castillo', 'Mesa', 'Leyva', 'Marrero', 'Hechavarría', 'Despaigne',
      'Osoria', 'Iznaga', 'Camacho', 'Cárdenas', 'Gato', 'Matienzo', 'Bisset', 'Calderón', 'Estrada', 'Lescay', 'Mora',
      'Peña', 'Sarmiento', 'Rivero', 'Guerra', 'Rosales', 'Pineda', 'Montalvo', 'Batista', 'Dueñas', 'Lazo', 'Hierrezuelo',
      'Ramos', 'Duarte', 'Acosta', 'Salas', 'Verdecia'],
  },
  brazilian: {
    first: ['Lucas', 'Gabriel', 'Matheus', 'Rafael', 'Felipe', 'Gustavo', 'Leonardo', 'Bruno', 'Thiago', 'Rodrigo',
      'Vinícius', 'Eduardo', 'Ricardo', 'Douglas', 'Wallace', 'Maurício', 'Isac', 'Flávio', 'Alan', 'Darlan', 'Leandro',
      'Renan', 'Fernando', 'Otávio', 'Caio', 'Henrique', 'Murilo', 'Diego', 'Danilo', 'Samuel', 'Pedro', 'João', 'Arthur',
      'Davi', 'Enzo', 'Victor', 'Guilherme', 'Igor', 'Marcelo'],
    last: ['Dias', 'Castro', 'Pinto', 'Lopes', 'Mendes', 'Ramos', 'Vieira', 'Nunes', 'Soares', 'Fernandes', 'Gonçalves',
      'Marques', 'Alves', 'Batista', 'Campos', 'Moura', 'Andrade', 'Machado', 'Melo', 'Reis', 'Fonseca', 'Mello', 'Barros',
      'Duarte', 'Pires', 'Rezende', 'Coelho', 'Brito', 'Farias', 'Leite', 'Nogueira', 'Assis', 'Borges', 'Siqueira',
      'Tavares', 'Aguiar', 'Bezerra', 'Macedo', 'Peixoto', 'Queiroz', 'Sales', 'Bastos', 'Cavalcanti', 'Guimarães',
      'Lacerda', 'Medeiros', 'Miranda', 'Prado', 'Toledo', 'Vasconcelos', 'Xavier', 'Bueno', 'Cruz', 'Diniz', 'Fagundes',
      'Lemos', 'Matos', 'Pacheco', 'Rangel', 'Sampaio', 'Valente', 'Viana', 'Brandão', 'Amaral', 'Cordeiro', 'Paiva',
      'Franco', 'Neves', 'Muniz', 'Bittencourt'],
  },
  portuguese: {
    first: ['José', 'António', 'Manuel', 'Carlos', 'Luís', 'Paulo', 'Jorge', 'Fernando', 'Sérgio', 'Daniel', 'David',
      'Gabriel', 'Martim', 'Santiago', 'Leonardo', 'Henrique', 'Rafael', 'Gustavo', 'Lucas', 'Samuel', 'Dinis', 'Bernardo',
      'Caetano', 'Mateus', 'Vicente', 'Matias', 'Fábio', 'Hélder', 'Joel', 'Ivo'],
    last: ['Fonseca', 'Rocha', 'Monteiro', 'Mota', 'Cardoso', 'Lima', 'Araújo', 'Barbosa', 'Vieira', 'Antunes', 'Matos',
      'Freitas', 'Simões', 'Coelho', 'Cruz', 'Cunha', 'Reis', 'Machado', 'Batista', 'Tavares', 'Magalhães', 'Brito',
      'Campos', 'Rosa', 'Neves', 'Leite', 'Faria', 'Pires', 'Moura', 'Henriques', 'Baptista', 'Domingues', 'Figueiredo',
      'Guerreiro', 'Branco', 'Paiva', 'Valente', 'Vaz', 'Esteves', 'Amaral', 'Andrade', 'Couto', 'Lourenço', 'Macedo',
      'Morais', 'Nogueira', 'Patrício', 'Quintela', 'Sequeira', 'Torres', 'Vicente', 'Azevedo', 'Barros', 'Castro',
      'Duarte', 'Melo', 'Miranda', 'Pacheco', 'Ramos', 'Salgado', 'Serra', 'Sampaio', 'Tomé'],
  },
  italian: {
    first: ['Alessandro', 'Lorenzo', 'Matteo', 'Andrea', 'Francesco', 'Gabriele', 'Riccardo', 'Davide', 'Tommaso',
      'Federico', 'Simone', 'Luca', 'Marco', 'Stefano', 'Giacomo', 'Nicola', 'Pietro', 'Filippo', 'Daniele', 'Michele',
      'Fabio', 'Roberto', 'Emanuele', 'Gianluca', 'Mattia', 'Edoardo', 'Leonardo', 'Samuele', 'Jacopo', 'Yuri', 'Oreste'],
    last: ['Bellini', 'Marchetti', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale',
      'Lombardo', 'Serra', 'Coppola', 'De Santis', "D'Angelo", 'Marchi', 'Parisi', 'Villa', 'Conte', 'Ferraro', 'Ferri',
      'Fabbri', 'Bianco', 'Marini', 'Grasso', 'Valentini', 'Messina', 'Sala', 'De Angelis', 'Gatti', 'Pellegrini',
      'Palumbo', 'Sanna', 'Farina', 'Rizzi', 'Monti', 'Cattaneo', 'Morelli', 'Amato', 'Silvestri', 'Mazza', 'Testa',
      'Grassi', 'Pellegrino', 'Carbone', 'Giuliani', 'Benedetti', 'Barone', 'Rossetti', 'Caputo', 'Montanari', 'Guerra',
      'Palmieri', 'Bernardi', 'Martino', 'Fiore', 'De Rosa', 'Ferretti', 'Bellucci', 'Basile', 'Riva', 'Donati', 'Piras',
      'Vitali', 'Battaglia', 'Sartori', 'Neri', 'Costantini', 'Milani', 'Pagano', 'Ruggiero', 'Sorrentino', "D'Amico",
      'Orlando', 'Negri', 'Zanetti', 'Giannelli', 'Anzani'],
  },
  french: {
    first: ['Antoine', 'Benjamin', 'Kévin', 'Jean', 'Thibault', 'Hugo', 'Léo', 'Lucas', 'Louis', 'Gabriel', 'Arthur',
      'Raphaël', 'Jules', 'Adam', 'Nathan', 'Théo', 'Maxime', 'Alexandre', 'Quentin', 'Romain', 'Julien', 'Nicolas',
      'Guillaume', 'Florian', 'Clément', 'Baptiste', 'Mathieu', 'Jérémy', 'Sébastien', 'Benoît', 'Trévor', 'Barthélémy'],
    last: ['Morel', 'André', 'Lefèvre', 'Dupuis', 'Guérin', 'Boyer', 'Garnier', 'Chevalier', 'François', 'Legrand',
      'Gauthier', 'Perrin', 'Robin', 'Clément', 'Morin', 'Nicolas', 'Henry', 'Roussel', 'Mathieu', 'Masson', 'Marchand',
      'Duval', 'Denis', 'Dumont', 'Lemaire', 'Noël', 'Meyer', 'Dufour', 'Meunier', 'Brun', 'Blanchard', 'Giraud', 'Joly',
      'Rivière', 'Brunet', 'Gaillard', 'Barbier', 'Arnaud', 'Gérard', 'Roche', 'Renard', 'Schmitt', 'Roy', 'Leroux',
      'Colin', 'Vidal', 'Caron', 'Picard', 'Roger', 'Fabre', 'Aubert', 'Lemoine', 'Renaud', 'Dumas', 'Lacroix', 'Olivier',
      'Philippe', 'Bourgeois', 'Pierre', 'Benoît', 'Leclerc', 'Payet', 'Rolland', 'Guillaume', 'Lecomte', 'Dupuy',
      'Guillot', 'Hubert', 'Berger', 'Carpentier', 'Moulin', 'Deschamps', 'Huet', 'Vasseur', 'Boucher', 'Fleury', 'Royer',
      'Klein', 'Jacquet', 'Poirier', 'Marty', 'Aubry', 'Guyot', 'Carré', 'Charpentier', 'Ménard', 'Maillard', 'Baron',
      'Bertin', 'Bailly', 'Hervé', 'Le Gall', 'Collet', 'Léger', 'Bouvier', 'Prévost', 'Millet', 'Le Roux', 'Germain',
      'Breton', 'Besson', 'Langlois', 'Pelletier', 'Leblanc', 'Lebrun', 'Weber', 'Hamon', 'Boulanger', 'Grondin', 'Tessier'],
  },
};

/** Surnames two in Spain (the father's, then the mother's): how often a player goes by both. */
export const DOUBLE_SURNAME: Readonly<Record<string, number>> = { spanish: 0.14, argentine: 0.04 };
