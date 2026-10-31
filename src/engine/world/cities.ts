/**
 * City and club-name banks.
 *
 * Volleyball clubs are usually named for their city plus a sponsor or a
 * traditional society name, which is why the suffix lists differ by country —
 * an Italian side is a "Pallavolo", a Polish one a "Sokół". Every one of them is
 * made up: no real club's or sponsor's name, only the cities are real.
 */

export interface CityBank {
  cities: readonly string[];
  suffixes: readonly string[];
}

const GENERIC_SUFFIX = ['Volley', 'VC', 'Volleyball Club', 'Sport'];

export const CITY_BANKS: Readonly<Record<string, CityBank>> = {
  polish: {
    cities: ['Kędzierzyn-Koźle', 'Rzeszów', 'Warszawa', 'Kraków', 'Bełchatów', 'Zawiercie', 'Lublin', 'Olsztyn', 'Gdańsk', 'Bydgoszcz', 'Katowice', 'Wrocław', 'Poznań', 'Radom', 'Suwałki', 'Nysa', 'Częstochowa', 'Szczecin', 'Łódź', 'Toruń'],
    suffixes: ['Sokół', 'Orzeł', 'Iskra', 'Huragan', 'Błękitni', 'Gwardia', 'Siatkarz', 'Volley'],
  },
  italian: {
    cities: ['Perugia', 'Trento', 'Civitanova', 'Modena', 'Piacenza', 'Milano', 'Verona', 'Monza', 'Padova', 'Taranto', 'Cisterna', 'Ravenna', 'Vibo Valentia', 'Latina', 'Siena', 'Cuneo', 'Bergamo', 'Catania', 'Brescia', 'Firenze'],
    suffixes: ['Pallavolo', 'Volley', 'Virtus', 'Polisportiva', 'Libertas', 'Azzurra', 'Robur'],
  },
  french: {
    cities: ['Tours', 'Montpellier', 'Chaumont', 'Poitiers', 'Nantes', 'Toulouse', 'Paris', 'Cannes', 'Narbonne', 'Sète', 'Ajaccio', 'Nice', 'Lyon', 'Rennes', 'Nancy', 'Beauvais', 'Saint-Nazaire', 'Avignon', 'Martigues', 'Orléans'],
    suffixes: ['Volley-Ball', 'VB', 'Volley', 'Sports'],
  },
  slovene: {
    cities: ['Ljubljana', 'Maribor', 'Kamnik', 'Nova Gorica', 'Koper', 'Celje', 'Kranj', 'Velenje', 'Murska Sobota', 'Domžale', 'Novo Mesto', 'Ptuj', 'Trbovlje', 'Jesenice', 'Škofja Loka', 'Krško'],
    suffixes: ['OK', 'Volley', 'Sokol', 'Triglav', 'Odbojka'],
  },
  serbian: {
    cities: ['Beograd', 'Novi Sad', 'Niš', 'Kragujevac', 'Subotica', 'Zrenjanin', 'Kraljevo', 'Čačak', 'Užice', 'Pančevo', 'Šabac', 'Valjevo', 'Smederevo', 'Leskovac', 'Sombor', 'Vranje'],
    suffixes: ['OK', 'Radnički', 'Sloga', 'Jedinstvo', 'Mladost'],
  },
  dutch: {
    cities: ['Amstelveen', 'Rotterdam', 'Groningen', 'Doetinchem', 'Apeldoorn', 'Almere', 'Utrecht', 'Eindhoven', 'Zwolle', 'Maaseik', 'Roeselare', 'Antwerpen', 'Gent', 'Leuven', 'Brugge', 'Haasrode'],
    suffixes: ['Volleybal', 'VC', 'Tornado', 'Delta', 'Polder'],
  },
  german: {
    cities: ['Berlin', 'Friedrichshafen', 'Lüneburg', 'Frankfurt', 'Düren', 'Karlsruhe', 'Herrsching', 'Bühl', 'Giesen', 'Königs Wusterhausen', 'Hachenburg', 'München', 'Innsbruck', 'Wien', 'Amriswil', 'Näfels'],
    suffixes: ['Volleys', 'VC', 'SVG', 'TSV', 'Volleyball'],
  },
  bulgarian: {
    cities: ['Sofia', 'Plovdiv', 'Varna', 'Burgas', 'Ruse', 'Stara Zagora', 'Pleven', 'Gabrovo', 'Dobrich', 'Blagoevgrad', 'Pernik', 'Sliven', 'Vratsa', 'Kazanlak', 'Montana', 'Shumen'],
    suffixes: ['VC', 'Balkan', 'Rila', 'Volley', 'Yunak'],
  },
  ukrainian: {
    cities: ['Kyiv', 'Kharkiv', 'Odesa', 'Lviv', 'Dnipro', 'Vinnytsia', 'Zaporizhzhia', 'Cherkasy', 'Poltava', 'Chernihiv', 'Zhytomyr', 'Rivne', 'Ternopil', 'Sumy', 'Lutsk', 'Uzhhorod'],
    suffixes: ['VC', 'Kozaky', 'Sokil', 'Volley', 'Zirka'],
  },
  turkish: {
    cities: ['İstanbul', 'Ankara', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Kayseri', 'Gaziantep', 'Trabzon', 'Samsun', 'Eskişehir', 'Denizli', 'Malatya', 'Sivas', 'Erzurum'],
    suffixes: ['Spor', 'Voleybol', 'Gençlik', 'Kartallar', 'Yıldız', 'Şimşek'],
  },
  russian: {
    cities: ['Kazan', 'Novosibirsk', 'Belgorod', 'Moskva', 'Ufa', 'Kemerovo', 'Surgut', 'Krasnodar', 'Perm', 'Nizhny Novgorod', 'Yekaterinburg', 'Samara', 'Orenburg', 'Chelyabinsk', 'Voronezh', 'Omsk'],
    suffixes: ['Sokol', 'Volna', 'Molniya', 'Burevestnik', 'Zvezda', 'Volley'],
  },
  czech: {
    cities: ['Praha', 'Brno', 'Ostrava', 'Liberec', 'Karlovarsko', 'České Budějovice', 'Zlín', 'Olomouc', 'Plzeň', 'Ústí nad Labem', 'Bratislava', 'Košice', 'Nitra', 'Prešov', 'Trenčín', 'Žilina'],
    suffixes: ['VK', 'Volejbal', 'Sokol', 'Jiskra'],
  },
  greek: {
    cities: ['Athina', 'Thessaloniki', 'Patra', 'Iraklio', 'Larisa', 'Volos', 'Ioannina', 'Kavala', 'Chania', 'Kalamata', 'Rodos', 'Serres', 'Lamia', 'Xanthi', 'Kozani', 'Drama'],
    suffixes: ['VC', 'Olympos', 'Thyella', 'Asteras', 'Poseidon'],
  },
  finnish: {
    cities: ['Helsinki', 'Tampere', 'Turku', 'Oulu', 'Kuopio', 'Jyväskylä', 'Lahti', 'Vantaa', 'Espoo', 'Pori', 'Kokkola', 'Vaasa', 'Joensuu', 'Hämeenlinna', 'Rovaniemi', 'Mikkeli'],
    suffixes: ['Volley', 'Lentopallo', 'Myrsky', 'Karhut', 'Kotkat'],
  },
  portuguese: {
    cities: ['Lisboa', 'Porto', 'Braga', 'Coimbra', 'Aveiro', 'Setúbal', 'Guimarães', 'Espinho', 'Leiria', 'Viseu', 'Faro', 'Funchal', 'Ponta Delgada', 'Vila Real', 'Beja', 'Évora'],
    suffixes: ['Voleibol', 'AA', 'Clube', 'Atlético', 'Desportivo'],
  },
  spanish: {
    cities: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Zaragoza', 'Palma', 'Teruel', 'Almería', 'Bilbao', 'Málaga', 'Murcia', 'Valladolid', 'Vigo', 'Santander', 'Las Palmas', 'Alicante'],
    suffixes: ['Voleibol', 'CV', 'Club Voleibol', 'Atlético'],
  },
  croatian: {
    cities: ['Zagreb', 'Split', 'Rijeka', 'Osijek', 'Zadar', 'Varaždin', 'Šibenik', 'Dubrovnik', 'Pula', 'Karlovac', 'Slavonski Brod', 'Sisak', 'Vinkovci', 'Bjelovar', 'Koprivnica', 'Samobor'],
    suffixes: ['OK', 'Volley', 'Jadran', 'Sloga'],
  },
  romanian: {
    cities: ['București', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Craiova', 'Galați', 'Constanța', 'Brașov', 'Ploiești', 'Oradea', 'Arad', 'Sibiu', 'Bacău', 'Pitești', 'Târgu Mureș', 'Suceava'],
    suffixes: ['Volei', 'CSM', 'Viitorul', 'Unirea', 'Vulturii'],
  },
  estonian: {
    cities: ['Tallinn', 'Tartu', 'Pärnu', 'Narva', 'Viljandi', 'Rakvere', 'Kuressaare', 'Võru', 'Valga', 'Haapsalu', 'Jõhvi', 'Paide', 'Keila', 'Elva', 'Põlva', 'Türi'],
    suffixes: ['VK', 'Võrkpalliklubi', 'Tormid', 'Kotkad'],
  },
  latvian: {
    cities: ['Rīga', 'Daugavpils', 'Liepāja', 'Jelgava', 'Jūrmala', 'Ventspils', 'Rēzekne', 'Valmiera', 'Ogre', 'Tukums', 'Salaspils', 'Cēsis', 'Kuldīga', 'Saldus', 'Talsi', 'Bauska'],
    suffixes: ['VK', 'Volejbols', 'Vētra', 'Ērgļi'],
  },
  nordic: {
    cities: ['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Linköping', 'Örebro', 'København', 'Aarhus', 'Odense', 'Aalborg', 'Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Sønderborg', 'Hylte'],
    suffixes: ['VBK', 'Volley', 'IF', 'Volleyballklubb'],
  },
  hungarian: {
    cities: ['Budapest', 'Debrecen', 'Szeged', 'Miskolc', 'Pécs', 'Győr', 'Nyíregyháza', 'Kecskemét', 'Székesfehérvár', 'Szombathely', 'Szolnok', 'Kaposvár', 'Veszprém', 'Békéscsaba', 'Eger', 'Dunaújváros'],
    suffixes: ['SE', 'Röplabda', 'RSE', 'Sólymok'],
  },
  hebrew: {
    cities: ['Tel Aviv', 'Jerusalem', 'Haifa', 'Beer Sheva', 'Netanya', 'Ashdod', 'Rishon LeZion', 'Petah Tikva', 'Holon', 'Kfar Saba', 'Herzliya', 'Ramat Gan', 'Hadera', 'Rehovot', 'Nahariya', 'Eilat'],
    suffixes: ['Maccabi', 'Hapoel', 'VC'],
  },
  brazilian: {
    cities: ['Contagem', 'Taubaté', 'Campinas', 'Maringá', 'Ribeirão Preto', 'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Blumenau', 'Uberlândia', 'Brasília', 'Recife', 'Fortaleza', 'Goiânia'],
    suffixes: ['Vôlei', 'EC', 'Atlético', 'Esporte Clube', 'Vôlei Clube', 'Tubarões'],
  },
  argentine: {
    cities: ['Buenos Aires', 'Bolívar', 'Córdoba', 'Rosario', 'La Plata', 'Mendoza', 'San Juan', 'Tucumán', 'Mar del Plata', 'Santa Fe', 'Neuquén', 'Salta', 'Paraná', 'Bahía Blanca', 'Formosa', 'Río Cuarto'],
    suffixes: ['Vóley', 'Club', 'Atlético', 'Deportivo'],
  },
  american: {
    cities: ['Los Angeles', 'Chicago', 'Dallas', 'Denver', 'Seattle', 'Atlanta', 'Columbus', 'Madison', 'Omaha', 'San Diego', 'Austin', 'Orlando', 'Phoenix', 'Houston', 'Minneapolis', 'Kansas City', 'Portland', 'Charlotte', 'Nashville', 'Sacramento'],
    suffixes: ['Volleyball Club', 'VC', 'Elite', 'Athletics'],
  },
  canadian: {
    cities: ['Toronto', 'Vancouver', 'Calgary', 'Montreal', 'Ottawa', 'Edmonton', 'Winnipeg', 'Quebec City', 'Hamilton', 'Kitchener', 'Halifax', 'Victoria', 'Saskatoon', 'Regina', 'London', 'Windsor'],
    suffixes: ['Volleyball Club', 'VC', 'Storm', 'Athletics'],
  },
  australian: {
    cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Wollongong', 'Hobart', 'Geelong', 'Townsville', 'Cairns', 'Darwin', 'Ballarat', 'Bendigo'],
    suffixes: ['Volleyball Club', 'VC', 'Thunder', 'Sports'],
  },
  cuban: {
    cities: ['La Habana', 'Santiago de Cuba', 'Camagüey', 'Holguín', 'Villa Clara', 'Matanzas', 'Cienfuegos', 'Pinar del Río', 'Las Tunas', 'Granma', 'Guantánamo', 'Sancti Spíritus', 'Ciego de Ávila', 'Artemisa', 'Mayabeque', 'Isla de la Juventud'],
    suffixes: ['Voleibol', 'VC'],
  },
  japanese: {
    cities: ['Osaka', 'Tokyo', 'Nagoya', 'Sakai', 'Toyota', 'Hiroshima', 'Okayama', 'Takasaki', 'Toyohashi', 'Fukuoka', 'Sendai', 'Sapporo', 'Kobe', 'Kyoto', 'Yokohama', 'Shizuoka'],
    suffixes: ['Cranes', 'Kitsune', 'Tsunami', 'Ravens', 'Comets', 'Phoenixes'],
  },
  iranian: {
    cities: ['Tehran', 'Urmia', 'Isfahan', 'Mashhad', 'Shiraz', 'Tabriz', 'Ahvaz', 'Qom', 'Karaj', 'Kerman', 'Rasht', 'Yazd', 'Hamadan', 'Arak', 'Zanjan', 'Sari'],
    suffixes: ['VC', 'Setareh', 'Oghab', 'Toufan', 'Shahin'],
  },
  chinese: {
    cities: ['Shanghai', 'Beijing', 'Jiangsu', 'Shandong', 'Zhejiang', 'Sichuan', 'Guangdong', 'Henan', 'Hubei', 'Fujian', 'Liaoning', 'Tianjin', 'Hebei', 'Yunnan', 'Shaanxi', 'Jilin'],
    suffixes: ['Volleyball Club', 'VC', 'Dragons', 'Phoenix'],
  },
  korean: {
    cities: ['Seoul', 'Incheon', 'Daejeon', 'Suwon', 'Ansan', 'Cheonan', 'Uijeongbu', 'Gumi', 'Busan', 'Daegu', 'Gwangju', 'Ulsan', 'Changwon', 'Jeonju', 'Chuncheon', 'Pohang'],
    suffixes: ['VC', 'Cranes', 'Thunder', 'Dolphins', 'Storm'],
  },
  arabic: {
    cities: ['Cairo', 'Alexandria', 'Giza', 'Tunis', 'Sfax', 'Sousse', 'Casablanca', 'Rabat', 'Marrakech', 'Algiers', 'Oran', 'Doha', 'Al Rayyan', 'Port Said', 'Mansoura', 'Ismailia'],
    suffixes: ['Club', 'SC', 'Al Najm', 'Al Saqr', 'Al Barq', 'Al Rimal'],
  },
  indian: {
    cities: ['Chennai', 'Kolkata', 'Mumbai', 'Delhi', 'Hyderabad', 'Bengaluru', 'Kochi', 'Ahmedabad', 'Pune', 'Jaipur', 'Lucknow', 'Bhopal', 'Kozhikode', 'Coimbatore', 'Nagpur', 'Patna'],
    suffixes: ['Volleyball Club', 'Smashers', 'Blockers', 'Titans'],
  },
  thai: {
    cities: ['Bangkok', 'Nakhon Ratchasima', 'Chiang Mai', 'Khon Kaen', 'Phuket', 'Udon Thani', 'Hat Yai', 'Rayong', 'Chonburi', 'Nonthaburi', 'Ayutthaya', 'Surat Thani', 'Lampang', 'Trang', 'Ubon Ratchathani', 'Phitsanulok'],
    suffixes: ['VC', 'Volleyball Club', 'Siam'],
  },
  african: {
    cities: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Yaoundé', 'Douala', 'Nairobi', 'Lagos', 'Accra', 'Dakar', 'Abidjan', 'Kampala', 'Dar es Salaam', 'Luanda', 'Maputo', 'Harare'],
    suffixes: ['Volleyball Club', 'VC', 'Sports Club'],
  },
};

export function cityBankFor(group: string): CityBank {
  return CITY_BANKS[group] ?? { cities: CITY_BANKS.american.cities, suffixes: GENERIC_SUFFIX };
}
