/**
 * Name banks, grouped by linguistic region rather than by nation, so that
 * countries sharing a naming tradition draw from the same pool.
 *
 * These generate the fictional players who populate the world and every regen
 * born into it over a fifty-season career. Real players only enter the database
 * through the FIVB VIS importer, never from here.
 */

export interface NameBank {
  first: readonly string[];
  last: readonly string[];
}

export const NAME_BANKS: Readonly<Record<string, NameBank>> = {
  polish: {
    first: ['Bartosz', 'Kamil', 'Wojciech', 'Mateusz', 'Jakub', 'Michał', 'Paweł', 'Tomasz', 'Piotr', 'Łukasz', 'Aleksander', 'Norbert', 'Karol', 'Grzegorz', 'Marcin', 'Dawid', 'Rafał', 'Krzysztof', 'Damian', 'Sebastian', 'Artur', 'Jan', 'Adrian', 'Filip', 'Maciej', 'Szymon'],
    last: ['Kowalski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Nowicki', 'Pawłowski', 'Michalski', 'Adamczyk', 'Dudek', 'Zając', 'Wieczorek', 'Jabłoński', 'Król'],
  },
  italian: {
    first: ['Simone', 'Alessandro', 'Matteo', 'Lorenzo', 'Francesco', 'Riccardo', 'Daniele', 'Gabriele', 'Luca', 'Marco', 'Andrea', 'Giulio', 'Davide', 'Tommaso', 'Filippo', 'Nicola', 'Roberto', 'Fabio', 'Yuri', 'Emanuele', 'Federico', 'Giacomo', 'Leonardo', 'Stefano', 'Antonio', 'Michele'],
    last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Costa', 'Giordano', 'Mancini', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso'],
  },
  french: {
    first: ['Earvin', 'Jean', 'Antoine', 'Trévor', 'Barthélémy', 'Nicolas', 'Kévin', 'Yacine', 'Benjamin', 'Théo', 'Julien', 'Quentin', 'Baptiste', 'Lucas', 'Hugo', 'Maxime', 'Rémi', 'Clément', 'Alexandre', 'Thibault', 'Nathan', 'Gabin', 'Enzo', 'Mathis', 'Corentin', 'Louis'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Mercier'],
  },
  slovene: {
    first: ['Tine', 'Klemen', 'Jan', 'Alen', 'Gregor', 'Rok', 'Žiga', 'Tonček', 'Matej', 'Uroš', 'Dejan', 'Nejc', 'Miha', 'Luka', 'Jani', 'Sašo', 'Blaž', 'Anže', 'Domen', 'Aleks', 'Primož', 'Jure', 'Marko', 'Denis', 'Vid', 'Tim'],
    last: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik', 'Kovač', 'Mlakar', 'Vidmar', 'Golob', 'Turk', 'Božič', 'Kos', 'Bizjak', 'Hribar', 'Petek', 'Zupan', 'Kotnik', 'Rozman', 'Šuštaršič', 'Oblak', 'Jereb', 'Pavlin', 'Ferlin', 'Klemenčič', 'Štern'],
  },
  serbian: {
    first: ['Uroš', 'Nikola', 'Aleksandar', 'Marko', 'Dražen', 'Petar', 'Miran', 'Srećko', 'Nemanja', 'Stefan', 'Milan', 'Luka', 'Dušan', 'Vuk', 'Filip', 'Bojan', 'Lazar', 'Đorđe', 'Miloš', 'Ivan', 'Nenad', 'Vladimir', 'Slobodan', 'Zoran', 'Danilo', 'Strahinja'],
    last: ['Jovanović', 'Petrović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović', 'Ilić', 'Stanković', 'Pavlović', 'Milošević', 'Todorović', 'Popović', 'Simić', 'Ristić', 'Kovačević', 'Lukić', 'Mitrović', 'Živković', 'Radovanović', 'Božović', 'Vasić', 'Perić', 'Savić', 'Antić', 'Krsmanović', 'Kurić'],
  },
  dutch: {
    first: ['Nimir', 'Bennie', 'Thijs', 'Wessel', 'Maarten', 'Sander', 'Jasper', 'Robbert', 'Luuc', 'Fabian', 'Michael', 'Gijs', 'Twan', 'Bram', 'Daan', 'Sem', 'Ruben', 'Stijn', 'Joris', 'Niels', 'Tim', 'Jelte', 'Koen', 'Lars', 'Pepijn', 'Rens'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer', 'Timmermans'],
  },
  german: {
    first: ['Georg', 'Lukas', 'Denys', 'Moritz', 'Tobias', 'Anton', 'Julian', 'Linus', 'Ruben', 'Erik', 'Simon', 'Jonas', 'Marcus', 'Philipp', 'Sebastian', 'Christian', 'Florian', 'Maximilian', 'Nils', 'Leon', 'Felix', 'Jan', 'David', 'Niklas', 'Tim', 'Fabian'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Werner'],
  },
  bulgarian: {
    first: ['Aleksandar', 'Tsvetan', 'Martin', 'Nikolay', 'Simeon', 'Georgi', 'Dimitar', 'Ivan', 'Todor', 'Preslav', 'Asparuh', 'Rozalin', 'Venislav', 'Stoyan', 'Krasimir', 'Plamen', 'Valentin', 'Boris', 'Emil', 'Iliya', 'Kaloyan', 'Radoslav', 'Svetoslav', 'Vladislav', 'Zhivko', 'Yordan'],
    last: ['Ivanov', 'Georgiev', 'Dimitrov', 'Petrov', 'Nikolov', 'Todorov', 'Hristov', 'Stoyanov', 'Marinov', 'Angelov', 'Kolev', 'Iliev', 'Vasilev', 'Atanasov', 'Yankov', 'Grozdanov', 'Bratoev', 'Sokolov', 'Zhelyazkov', 'Rusev', 'Aleksiev', 'Penev', 'Kirilov', 'Borisov', 'Mihaylov', 'Tsvetanov'],
  },
  ukrainian: {
    first: ['Oleh', 'Yurii', 'Vasyl', 'Andrii', 'Serhii', 'Dmytro', 'Illia', 'Bohdan', 'Maksym', 'Volodymyr', 'Mykyta', 'Ihor', 'Taras', 'Danylo', 'Artem', 'Vitalii', 'Roman', 'Oleksandr', 'Pavlo', 'Yevhen', 'Kyrylo', 'Nazar', 'Ruslan', 'Stanislav', 'Vadym', 'Denys'],
    last: ['Shevchenko', 'Kovalenko', 'Boyko', 'Tkachenko', 'Kravchenko', 'Oliynyk', 'Shevchuk', 'Koval', 'Polishchuk', 'Bondarenko', 'Tkachuk', 'Moroz', 'Marchenko', 'Lysenko', 'Rudenko', 'Savchenko', 'Petrenko', 'Melnyk', 'Kharchenko', 'Plotnytskyi', 'Semeniuk', 'Didenko', 'Havrylenko', 'Yaroshenko', 'Kozlov', 'Zhurba'],
  },
  turkish: {
    first: ['Adis', 'Mert', 'Efe', 'Burutay', 'Yiğit', 'Emre', 'Berkay', 'Arslan', 'Doğukan', 'Murat', 'Kerem', 'Onur', 'Baturalp', 'Selim', 'Serkan', 'Volkan', 'Hakan', 'Tolga', 'Alper', 'Cem', 'Gökhan', 'İlker', 'Kaan', 'Ozan', 'Umut', 'Tarık'],
    last: ['Yılmaz', 'Kaya', 'Demir', 'Çelik', 'Şahin', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Korkmaz', 'Erdoğan', 'Güneş', 'Aktaş', 'Bulut'],
  },
  russian: {
    first: ['Maxim', 'Egor', 'Dmitry', 'Ivan', 'Viktor', 'Pavel', 'Artem', 'Denis', 'Ilya', 'Roman', 'Aleksey', 'Sergey', 'Yaroslav', 'Kirill', 'Nikita', 'Andrey', 'Vladislav', 'Anton', 'Aleksandr', 'Fyodor', 'Georgy', 'Timofey', 'Konstantin', 'Semyon', 'Valentin', 'Mikhail'],
    last: ['Ivanov', 'Smirnov', 'Kuznetsov', 'Popov', 'Vasiliev', 'Petrov', 'Sokolov', 'Mikhailov', 'Novikov', 'Fedorov', 'Morozov', 'Volkov', 'Alekseev', 'Lebedev', 'Semenov', 'Egorov', 'Pavlov', 'Kozlov', 'Stepanov', 'Nikolaev', 'Orlov', 'Andreev', 'Makarov', 'Nikitin', 'Zakharov', 'Belov'],
  },
  czech: {
    first: ['Jan', 'Petr', 'Lukáš', 'Tomáš', 'Martin', 'Adam', 'Ondřej', 'Marek', 'Filip', 'Jakub', 'David', 'Michal', 'Patrik', 'Radek', 'Vojtěch', 'Daniel', 'Josef', 'Milan', 'Pavel', 'Štěpán', 'Matěj', 'Dominik', 'Antonín', 'Karel', 'Šimon', 'Václav'],
    last: ['Novák', 'Svoboda', 'Novotný', 'Dvořák', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec', 'Marek', 'Pospíšil', 'Pokorný', 'Hájek', 'Král', 'Jelínek', 'Růžička', 'Beneš', 'Fiala', 'Sedláček', 'Doležal', 'Zeman', 'Kolář', 'Navrátil', 'Čermák', 'Vaněk'],
  },
  greek: {
    first: ['Dimitrios', 'Georgios', 'Ioannis', 'Konstantinos', 'Nikolaos', 'Panagiotis', 'Christos', 'Athanasios', 'Vasileios', 'Michail', 'Andreas', 'Alexandros', 'Stefanos', 'Theodoros', 'Ilias', 'Spyridon', 'Antonios', 'Evangelos', 'Petros', 'Emmanouil', 'Charalampos', 'Leonidas', 'Filippos', 'Anastasios', 'Marios', 'Sotirios'],
    last: ['Papadopoulos', 'Georgiou', 'Nikolaou', 'Ioannou', 'Vasileiou', 'Papadakis', 'Dimitriou', 'Antoniou', 'Christodoulou', 'Petrou', 'Makris', 'Konstantinidis', 'Papanikolaou', 'Alexiou', 'Athanasiou', 'Michailidis', 'Stavrou', 'Karagiannis', 'Oikonomou', 'Pappas', 'Vlachos', 'Samaras', 'Theodorou', 'Andreou', 'Christou', 'Lambrou'],
  },
  finnish: {
    first: ['Mikko', 'Juha', 'Antti', 'Sami', 'Ville', 'Eemi', 'Olli', 'Tuomas', 'Jukka', 'Lauri', 'Niko', 'Joonas', 'Matti', 'Elias', 'Onni', 'Aleksi', 'Urpo', 'Santeri', 'Veeti', 'Rasmus', 'Otto', 'Eetu', 'Leo', 'Väinö', 'Arttu', 'Kalle'],
    last: ['Korhonen', 'Virtanen', 'Mäkinen', 'Nieminen', 'Mäkelä', 'Hämäläinen', 'Laine', 'Heikkinen', 'Koskinen', 'Järvinen', 'Lehtonen', 'Lehtinen', 'Saarinen', 'Salminen', 'Heinonen', 'Niemi', 'Heikkilä', 'Kinnunen', 'Salonen', 'Turunen', 'Salo', 'Laitinen', 'Tuominen', 'Rantanen', 'Karjalainen', 'Jokinen'],
  },
  portuguese: {
    first: ['João', 'Miguel', 'Alexandre', 'Tiago', 'Ricardo', 'Bruno', 'Nuno', 'Rui', 'Pedro', 'André', 'Diogo', 'Marco', 'Gonçalo', 'Hugo', 'Filipe', 'Duarte', 'Rodrigo', 'Vasco', 'Tomás', 'Francisco', 'Afonso', 'Simão', 'Lourenço', 'Guilherme', 'Salvador', 'Xavier'],
    last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Jesus', 'Sousa', 'Fernandes', 'Gonçalves', 'Gomes', 'Lopes', 'Marques', 'Alves', 'Almeida', 'Ribeiro', 'Pinto', 'Carvalho', 'Teixeira', 'Moreira', 'Correia', 'Mendes', 'Nunes', 'Soares'],
  },
  spanish: {
    first: ['Jorge', 'Andrés', 'Sergio', 'Javier', 'Carlos', 'Miguel', 'Rafael', 'Manuel', 'Alberto', 'Daniel', 'Pablo', 'Ángel', 'Iván', 'Fernando', 'Rubén', 'Adrián', 'Álvaro', 'Diego', 'Raúl', 'Óscar', 'Jesús', 'Gonzalo', 'Marcos', 'Ignacio', 'Héctor', 'Emilio'],
    last: ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Álvarez', 'Muñoz', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil'],
  },
  croatian: {
    first: ['Ivan', 'Marko', 'Luka', 'Ante', 'Josip', 'Tomislav', 'Filip', 'Karlo', 'Mateo', 'Petar', 'Domagoj', 'Nikola', 'Borna', 'Duje', 'Toni', 'Leon', 'Roko', 'Fran', 'Bruno', 'Kristijan', 'Dario', 'Andrija', 'Šime', 'Vito', 'Jakov', 'Mihael'],
    last: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Kovačić', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Perić', 'Blažević', 'Grgić', 'Lovrić', 'Radić', 'Šarić', 'Barišić', 'Bogdan', 'Vidović', 'Klarić', 'Jukić', 'Filipović'],
  },
  romanian: {
    first: ['Andrei', 'Alexandru', 'Ionuț', 'Mihai', 'Cristian', 'Gabriel', 'Marius', 'Bogdan', 'Vlad', 'Răzvan', 'Sorin', 'Adrian', 'Daniel', 'Florin', 'Cătălin', 'Robert', 'Nicolae', 'Ștefan', 'Radu', 'Tudor', 'Darius', 'Sebastian', 'Iulian', 'Octavian', 'Valentin', 'Emil'],
    last: ['Popa', 'Popescu', 'Ionescu', 'Radu', 'Dumitru', 'Stan', 'Stoica', 'Gheorghe', 'Matei', 'Constantin', 'Marin', 'Tudor', 'Barbu', 'Nistor', 'Șerban', 'Ilie', 'Munteanu', 'Rusu', 'Diaconu', 'Nicolae', 'Avram', 'Lungu', 'Cristea', 'Dobre', 'Neagu', 'Voicu'],
  },
  estonian: {
    first: ['Robert', 'Renee', 'Timo', 'Kert', 'Andrus', 'Märt', 'Oliver', 'Karl', 'Rait', 'Siim', 'Henri', 'Marti', 'Kevin', 'Silver', 'Tanel', 'Martti', 'Alex', 'Kristo', 'Rasmus', 'Mihkel', 'Taavi', 'Sander', 'Joosep', 'Hindrek', 'Ardo', 'Erik'],
    last: ['Tamm', 'Saar', 'Sepp', 'Mägi', 'Kask', 'Kukk', 'Rebane', 'Ilves', 'Pärn', 'Koppel', 'Lepik', 'Kuusk', 'Teder', 'Toom', 'Raud', 'Männik', 'Aas', 'Hein', 'Vaher', 'Karu', 'Põld', 'Laur', 'Vahtra', 'Kivi', 'Nurm', 'Sild'],
  },
  latvian: {
    first: ['Jānis', 'Artūrs', 'Kristaps', 'Roberts', 'Edgars', 'Mārtiņš', 'Rihards', 'Toms', 'Kaspars', 'Aleksandrs', 'Reinis', 'Dāvis', 'Gatis', 'Normunds', 'Raivis', 'Emīls', 'Andris', 'Uģis', 'Klāvs', 'Niks', 'Ričards', 'Elvis', 'Deniss', 'Oskars', 'Lauris', 'Mareks'],
    last: ['Bērziņš', 'Kalniņš', 'Ozoliņš', 'Jansons', 'Ozols', 'Liepiņš', 'Krūmiņš', 'Balodis', 'Eglītis', 'Zariņš', 'Vītols', 'Kļaviņš', 'Vanags', 'Sproģis', 'Riekstiņš', 'Auziņš', 'Priede', 'Rudzītis', 'Celms', 'Lapsa', 'Dūmiņš', 'Grīnbergs', 'Skujiņš', 'Alksnis', 'Briedis', 'Egle'],
  },
  nordic: {
    first: ['Erik', 'Magnus', 'Anders', 'Lars', 'Nils', 'Henrik', 'Oskar', 'Emil', 'Axel', 'Viktor', 'Jonas', 'Mikkel', 'Kasper', 'Rasmus', 'Sebastian', 'Frederik', 'Elias', 'Hugo', 'Isak', 'Adam', 'Noah', 'Theo', 'Alfred', 'Sixten', 'Ludvig', 'Casper'],
    last: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Hansen', 'Nielsen', 'Jensen', 'Pedersen', 'Christensen', 'Larsen', 'Sørensen', 'Rasmussen', 'Jørgensen', 'Møller', 'Bakke', 'Haugen', 'Lund', 'Berg'],
  },
  hungarian: {
    first: ['Bálint', 'Gergely', 'Ádám', 'Máté', 'Dániel', 'Bence', 'Tamás', 'Zoltán', 'Levente', 'Kristóf', 'Márton', 'Péter', 'András', 'Attila', 'Gábor', 'Krisztián', 'Norbert', 'Zsolt', 'Ákos', 'Dávid', 'Botond', 'Csaba', 'Ferenc', 'István', 'László', 'Áron'],
    last: ['Nagy', 'Kovács', 'Tóth', 'Szabó', 'Horváth', 'Varga', 'Kiss', 'Molnár', 'Németh', 'Farkas', 'Balogh', 'Papp', 'Lakatos', 'Takács', 'Juhász', 'Mészáros', 'Oláh', 'Simon', 'Rácz', 'Fekete', 'Szűcs', 'Török', 'Fehér', 'Balázs', 'Gál', 'Kis'],
  },
  hebrew: {
    first: ['Noam', 'Itay', 'Yonatan', 'Omer', 'Ariel', 'Guy', 'Ido', 'Tomer', 'Roi', 'Amit', 'Eitan', 'Nadav', 'Shai', 'Lior', 'Gilad', 'Oren', 'Dor', 'Yuval', 'Alon', 'Erez', 'Barak', 'Ofir', 'Matan', 'Nir', 'Idan', 'Aviv'],
    last: ['Cohen', 'Levi', 'Mizrahi', 'Peretz', 'Biton', 'Dahan', 'Avraham', 'Friedman', 'Malka', 'Azoulay', 'Katz', 'Shapira', 'Gabay', 'Berger', 'Adler', 'Amar', 'Segal', 'Ben-David', 'Harel', 'Golan', 'Barkan', 'Weiss', 'Sharon', 'Regev', 'Elbaz', 'Naveh'],
  },
  brazilian: {
    first: ['Bruno', 'Wallace', 'Lucas', 'Ricardo', 'Yoandy', 'Maurício', 'Alan', 'Douglas', 'Thales', 'Rodrigo', 'Fernando', 'Leandro', 'Otávio', 'Adriano', 'Gustavo', 'Matheus', 'Felipe', 'Vinícius', 'Rafael', 'Gabriel', 'Renan', 'Isac', 'Judson', 'Darlan', 'Honorato', 'Cachopa'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Rodrigues', 'Almeida', 'Nascimento', 'Carvalho', 'Araújo', 'Ribeiro', 'Barbosa', 'Rocha', 'Cardoso', 'Gomes', 'Martins', 'Correia', 'Teixeira', 'Moreira', 'Azevedo', 'Monteiro', 'Cunha', 'Freitas'],
  },
  argentine: {
    first: ['Facundo', 'Bruno', 'Luciano', 'Agustín', 'Nicolás', 'Ezequiel', 'Santiago', 'Cristian', 'Matías', 'Franco', 'Sebastián', 'Tomás', 'Joaquín', 'Martín', 'Pablo', 'Gonzalo', 'Federico', 'Lautaro', 'Ignacio', 'Julián', 'Máximo', 'Valentín', 'Bautista', 'Thiago', 'Ramiro', 'Emiliano'],
    last: ['González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Pérez', 'García', 'Sánchez', 'Romero', 'Sosa', 'Torres', 'Álvarez', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Suárez', 'Aguirre', 'Giraudo', 'Palacios', 'Vicentín'],
  },
  american: {
    first: ['Matt', 'Aaron', 'Micah', 'Torey', 'Kyle', 'Jake', 'Taylor', 'Garrett', 'David', 'Erik', 'Thomas', 'Cody', 'Ryan', 'Brandon', 'Connor', 'Trevor', 'Dustin', 'Mason', 'Colby', 'Logan', 'Ethan', 'Caleb', 'Nathan', 'Jordan', 'Evan', 'Cameron'],
    last: ['Anderson', 'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'Allen', 'Wright', 'Scott', 'Green', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips'],
  },
  cuban: {
    first: ['Osniel', 'Miguel', 'Yoandy', 'Marlon', 'Javier', 'Robertlandy', 'Wilfredo', 'Jesús', 'Adrián', 'Liván', 'Yonder', 'Dariel', 'Alexander', 'Yosvany', 'Roberlandy', 'Norlan', 'Yordan', 'Osmany', 'Raydel', 'Leandro', 'Marlon', 'Abrahan', 'Yasniel', 'Julio', 'Reinaldo', 'Ernesto'],
    last: ['Hernández', 'Rodríguez', 'Pérez', 'García', 'Martínez', 'González', 'Sánchez', 'Díaz', 'Ramírez', 'Simón', 'Valdés', 'Herrera', 'Gutiérrez', 'Aguilera', 'Camejo', 'Concepción', 'Bell', 'Fonseca', 'Robles', 'Massó', 'Cepeda', 'Palacios', 'Alfonso', 'Quesada', 'Domínguez', 'Padrón'],
  },
  japanese: {
    first: ['Yuji', 'Ran', 'Kentaro', 'Masahiro', 'Yuki', 'Taishi', 'Akihiro', 'Tatsunori', 'Haku', 'Kento', 'Shunichi', 'Naonobu', 'Tomohiro', 'Issei', 'Kenta', 'Sota', 'Ryohei', 'Takahiro', 'Daiki', 'Shota', 'Hiroto', 'Yamato', 'Kaito', 'Riku', 'Sora', 'Haruto'],
    last: ['Nishida', 'Takahashi', 'Ishikawa', 'Yamamoto', 'Sekita', 'Onodera', 'Fukatsu', 'Otsuka', 'Yamauchi', 'Kobayashi', 'Sato', 'Suzuki', 'Tanaka', 'Watanabe', 'Ito', 'Nakamura', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Saito'],
  },
  iranian: {
    first: ['Amir', 'Milad', 'Morteza', 'Saeid', 'Mohammad', 'Ali', 'Javad', 'Esmaeil', 'Porya', 'Bardia', 'Aliasghar', 'Mehdi', 'Hossein', 'Reza', 'Sina', 'Amirhossein', 'Masoud', 'Behnam', 'Rahman', 'Meisam', 'Arman', 'Farhad', 'Kaveh', 'Omid', 'Shahram', 'Yousef'],
    last: ['Ghaemi', 'Ebadipour', 'Sharifi', 'Marouflakrani', 'Mousavi', 'Salehi', 'Karimi', 'Hosseini', 'Ahmadi', 'Rezaei', 'Mohammadi', 'Jafari', 'Abdolhamid', 'Esfandiar', 'Fayazi', 'Gholami', 'Kazemi', 'Nazari', 'Tabrizi', 'Vadi', 'Yousefi', 'Zarei', 'Farhan', 'Amini', 'Bakhshi', 'Sadeghi'],
  },
  chinese: {
    first: ['Yuantai', 'Chuan', 'Jiantong', 'Rui', 'Hao', 'Wei', 'Bin', 'Ming', 'Jie', 'Lei', 'Yang', 'Chen', 'Peng', 'Kai', 'Long', 'Feng', 'Xiang', 'Yu', 'Tao', 'Jun', 'Zhe', 'Kun', 'Sheng', 'Bo', 'Qiang', 'Hui'],
    last: ['Zhang', 'Wang', 'Li', 'Zhao', 'Chen', 'Liu', 'Yang', 'Huang', 'Zhou', 'Wu', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo', 'He', 'Lin', 'Gao', 'Luo', 'Zheng', 'Liang', 'Xie', 'Song', 'Tang', 'Han'],
  },
  korean: {
    first: ['Jin-seok', 'Min-jun', 'Ji-hoon', 'Seung-woo', 'Dong-hyun', 'Woo-jin', 'Hyun-woo', 'Jae-hyun', 'Tae-yang', 'Sung-min', 'Joon-ho', 'Kyung-min', 'Ha-jun', 'Si-woo', 'Do-yun', 'Yu-jin', 'Eun-woo', 'Geon-woo', 'Nam-il', 'Chan-yeol', 'Young-ho', 'Sang-hyun', 'Jun-seo', 'Ye-jun', 'Ji-ho', 'Min-seok'],
    last: ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Ryu', 'Hong', 'Jeon', 'Ko', 'Moon', 'Son', 'Bae', 'Baek'],
  },
  arabic: {
    first: ['Ahmed', 'Mohamed', 'Youssef', 'Omar', 'Karim', 'Mahmoud', 'Hassan', 'Ali', 'Khaled', 'Amr', 'Mostafa', 'Tarek', 'Sayed', 'Abdelrahman', 'Ibrahim', 'Hussein', 'Ayman', 'Bilal', 'Nader', 'Rami', 'Sami', 'Walid', 'Yassine', 'Zaid', 'Faisal', 'Marwan'],
    last: ['Abdelhay', 'Ibrahim', 'Hassan', 'Mohamed', 'Ali', 'Mahmoud', 'Said', 'Salem', 'Farouk', 'Nasser', 'Fathy', 'Shafik', 'Zaki', 'Kamel', 'Rashid', 'Haddad', 'Khalil', 'Mansour', 'Aziz', 'Toumi', 'Bouzid', 'Cherif', 'Trabelsi', 'Ben Ali', 'El Sayed', 'Gharbi'],
  },
  indian: {
    first: ['Arjun', 'Rohit', 'Vikas', 'Amit', 'Rahul', 'Sanjay', 'Karthik', 'Manoj', 'Prabagaran', 'Ajith', 'Naveen', 'Deepak', 'Ashwin', 'Suresh', 'Ravi', 'Vinod', 'Jerome', 'Gurinder', 'Ranjit', 'Ukkrapandian', 'Aman', 'Nikhil', 'Sandeep', 'Ajay', 'Vishal', 'Kiran'],
    last: ['Kumar', 'Singh', 'Sharma', 'Patel', 'Reddy', 'Nair', 'Menon', 'Rao', 'Verma', 'Gupta', 'Joshi', 'Iyer', 'Pillai', 'Chauhan', 'Yadav', 'Das', 'Bose', 'Malhotra', 'Kapoor', 'Vinoth', 'Jamwal', 'Thakur', 'Shetty', 'Prasad', 'Mishra', 'Bhat'],
  },
  thai: {
    first: ['Somchai', 'Kittipong', 'Anucha', 'Chaiwat', 'Narong', 'Pongsak', 'Wichai', 'Surachai', 'Thanakorn', 'Adisak', 'Nattapong', 'Weerapong', 'Sarawut', 'Kritsada', 'Jirayu', 'Peerapat', 'Montri', 'Apichart', 'Boonmee', 'Decha', 'Ekkachai', 'Krit', 'Prasit', 'Rattana', 'Sakda', 'Teerapat'],
    last: ['Saengsawang', 'Thongchai', 'Wongsawat', 'Chaiyaphum', 'Srisawat', 'Phromma', 'Kaewkla', 'Sombat', 'Rattanasak', 'Boonsong', 'Intara', 'Jaidee', 'Kanjana', 'Ladawan', 'Maneerat', 'Nakarin', 'Pattana', 'Rungruang', 'Sukhum', 'Tanawat', 'Udom', 'Wanchai', 'Yotsapon', 'Chanthara', 'Duangjai', 'Emsawat'],
  },
  african: {
    first: ['Emmanuel', 'Samuel', 'Joseph', 'Daniel', 'Michael', 'Peter', 'Kevin', 'Eric', 'Patrick', 'Francis', 'Simon', 'Nathan', 'Vincent', 'Thabo', 'Sipho', 'Lwazi', 'Kagiso', 'Tendai', 'Blessing', 'Chiedza', 'Landry', 'Christian', 'Ariel', 'Yannick', 'Serge', 'Boris'],
    last: ['Mokoena', 'Ndlovu', 'Dlamini', 'Nkosi', 'Mahlangu', 'Sithole', 'Khumalo', 'Zulu', 'Botha', 'van Wyk', 'Mbarga', 'Ngassa', 'Fotso', 'Tchoumi', 'Nkeng', 'Essomba', 'Owona', 'Bekono', 'Atangana', 'Mvondo', 'Onana', 'Eyenga', 'Nomo', 'Manga', 'Bilong', 'Ekambi'],
  },
};

export const DEFAULT_NAME_GROUP = 'american';

/** The women's game: first names by the same groups. */
const WOMEN_FIRST: Readonly<Record<string, readonly string[]>> = {
  polish: ['Agnieszka', 'Katarzyna', 'Magdalena', 'Joanna', 'Natalia', 'Malwina', 'Zuzanna', 'Martyna', 'Aleksandra', 'Kamila', 'Klaudia', 'Monika', 'Paulina', 'Weronika', 'Julia', 'Anna', 'Maria', 'Karolina', 'Justyna', 'Oliwia'],
  italian: ['Paola', 'Alessia', 'Miriam', 'Giulia', 'Francesca', 'Sofia', 'Chiara', 'Elena', 'Martina', 'Sara', 'Federica', 'Valentina', 'Anna', 'Ilaria', 'Beatrice', 'Caterina', 'Monica', 'Cristina', 'Gaia', 'Silvia'],
  french: ['Lucille', 'Héléna', 'Juliette', 'Camille', 'Léa', 'Chloé', 'Manon', 'Emma', 'Inès', 'Clara', 'Pauline', 'Marine', 'Laura', 'Julie', 'Océane', 'Margot', 'Lisa', 'Anaïs', 'Mathilde', 'Amandine'],
  slovene: ['Eva', 'Maja', 'Nika', 'Ana', 'Lara', 'Tjaša', 'Katja', 'Urška', 'Sara', 'Mojca', 'Tina', 'Špela', 'Neža', 'Pia', 'Zala', 'Lea', 'Jana', 'Petra', 'Anja', 'Saša'],
  serbian: ['Tijana', 'Maja', 'Jovana', 'Bojana', 'Milena', 'Brankica', 'Stefana', 'Bianka', 'Mina', 'Ana', 'Teodora', 'Jelena', 'Katarina', 'Sara', 'Marija', 'Ivana', 'Nataša', 'Sanja', 'Vesna', 'Dragana'],
  dutch: ['Lonneke', 'Celeste', 'Nika', 'Marrit', 'Laura', 'Britt', 'Anne', 'Femke', 'Sanne', 'Eline', 'Kirsten', 'Myrthe', 'Iris', 'Esther', 'Floor', 'Demi', 'Lotte', 'Fleur', 'Maret', 'Juliët'],
  german: ['Lina', 'Hanna', 'Camilla', 'Pia', 'Lena', 'Laura', 'Anna', 'Marie', 'Jana', 'Kimberly', 'Sarah', 'Luisa', 'Leonie', 'Jennifer', 'Saskia', 'Kathrin', 'Lisa', 'Antonia', 'Svenja', 'Mareike'],
  bulgarian: ['Maria', 'Elitsa', 'Hristina', 'Mira', 'Gergana', 'Nasya', 'Lora', 'Petya', 'Zhana', 'Desislava', 'Radostina', 'Silvana', 'Viktoria', 'Iveta', 'Dobriana', 'Emiliya', 'Nadezhda', 'Yoana', 'Kristina', 'Elena'],
  ukrainian: ['Olena', 'Yulia', 'Kateryna', 'Anastasiia', 'Diana', 'Tetiana', 'Oksana', 'Iryna', 'Mariia', 'Viktoriia', 'Alina', 'Yana', 'Khrystyna', 'Natalia', 'Daria', 'Sofiia', 'Olha', 'Valeriia', 'Polina', 'Yevheniia'],
  turkish: ['Zehra', 'Ebrar', 'Eda', 'Meliha', 'Hande', 'Melissa', 'Cansu', 'İlkin', 'Derya', 'Aslı', 'Elif', 'Simge', 'Gizem', 'Saliha', 'Kübra', 'Naz', 'Yasemin', 'Ayça', 'Tuğba', 'Buse'],
  russian: ['Ekaterina', 'Irina', 'Natalia', 'Anastasia', 'Tatiana', 'Yulia', 'Ksenia', 'Arina', 'Daria', 'Maria', 'Elena', 'Olga', 'Svetlana', 'Anna', 'Polina', 'Valeria', 'Vera', 'Alexandra', 'Yana', 'Kristina'],
  czech: ['Michaela', 'Kateřina', 'Tereza', 'Barbora', 'Veronika', 'Lucie', 'Eliška', 'Adéla', 'Kristýna', 'Nikola', 'Petra', 'Martina', 'Klára', 'Simona', 'Anna', 'Andrea', 'Monika', 'Hana', 'Pavla', 'Natálie'],
  greek: ['Maria', 'Eleni', 'Aikaterini', 'Georgia', 'Dimitra', 'Sofia', 'Anastasia', 'Vasiliki', 'Ioanna', 'Christina', 'Konstantina', 'Despoina', 'Evangelia', 'Paraskevi', 'Athina', 'Angeliki', 'Kyriaki', 'Panagiota', 'Stavroula', 'Efthymia'],
  finnish: ['Aino', 'Emilia', 'Iida', 'Veera', 'Ella', 'Noora', 'Laura', 'Jenni', 'Sanni', 'Saara', 'Anni', 'Elina', 'Johanna', 'Venla', 'Katri', 'Milla', 'Heidi', 'Minna', 'Riikka', 'Suvi'],
  portuguese: ['Inês', 'Beatriz', 'Mariana', 'Ana', 'Sofia', 'Leonor', 'Carolina', 'Joana', 'Rita', 'Marta', 'Catarina', 'Matilde', 'Francisca', 'Teresa', 'Raquel', 'Diana', 'Filipa', 'Vera', 'Sara', 'Margarida'],
  spanish: ['María', 'Lucía', 'Paula', 'Laura', 'Marta', 'Andrea', 'Sara', 'Carla', 'Elena', 'Claudia', 'Alba', 'Irene', 'Nerea', 'Ainhoa', 'Patricia', 'Cristina', 'Raquel', 'Noelia', 'Ana', 'Julia'],
  croatian: ['Samanta', 'Beta', 'Božana', 'Mia', 'Ana', 'Ivana', 'Lucija', 'Petra', 'Marija', 'Katarina', 'Ema', 'Lea', 'Nika', 'Iva', 'Dora', 'Klara', 'Matea', 'Tena', 'Martina', 'Sara'],
  romanian: ['Andreea', 'Alexandra', 'Ioana', 'Maria', 'Elena', 'Cristina', 'Diana', 'Bianca', 'Roxana', 'Adelina', 'Raluca', 'Mihaela', 'Gabriela', 'Daniela', 'Larisa', 'Alina', 'Oana', 'Teodora', 'Ana', 'Irina'],
  estonian: ['Kertu', 'Liis', 'Kadri', 'Mari', 'Kristiina', 'Eliise', 'Laura', 'Anna', 'Helen', 'Marleen', 'Grete', 'Kätlin', 'Triin', 'Kaisa', 'Maria', 'Hanna', 'Merili', 'Sandra', 'Gerli', 'Karmen'],
  latvian: ['Anna', 'Laura', 'Elīza', 'Marta', 'Sofija', 'Katrīna', 'Kristīne', 'Ieva', 'Līga', 'Agnese', 'Dace', 'Inese', 'Zane', 'Sanita', 'Madara', 'Evija', 'Linda', 'Santa', 'Baiba', 'Rūta'],
  nordic: ['Ida', 'Emma', 'Sara', 'Elin', 'Maja', 'Frida', 'Julia', 'Linnea', 'Hanna', 'Alva', 'Ingrid', 'Nora', 'Sofie', 'Astrid', 'Freja', 'Thea', 'Karin', 'Anna', 'Mathilde', 'Signe'],
  hungarian: ['Anna', 'Réka', 'Dóra', 'Eszter', 'Zsófia', 'Petra', 'Nóra', 'Lilla', 'Kitti', 'Fanni', 'Viktória', 'Bianka', 'Orsolya', 'Kinga', 'Edina', 'Krisztina', 'Henrietta', 'Laura', 'Boglárka', 'Zita'],
  hebrew: ['Noa', 'Tamar', 'Shira', 'Maya', 'Yael', 'Michal', 'Adi', 'Noga', 'Hila', 'Liron', 'Gal', 'Rotem', 'Inbar', 'Shani', 'Tal', 'Dana', 'Lior', 'Ayelet', 'Roni', 'Neta'],
  brazilian: ['Gabriela', 'Natália', 'Thaísa', 'Carolina', 'Macris', 'Rosamaria', 'Juliana', 'Fernanda', 'Tainara', 'Priscila', 'Camila', 'Adenízia', 'Roberta', 'Lorena', 'Kisy', 'Júlia', 'Tifanny', 'Mayany', 'Diana', 'Ana Cristina'],
  argentine: ['Lucía', 'Agustina', 'Bianca', 'Victoria', 'Candelaria', 'Antonela', 'Morena', 'Julieta', 'Sofía', 'Camila', 'Florencia', 'Micaela', 'Valentina', 'Daniela', 'Tatiana', 'Elina', 'Martina', 'Erika', 'Lourdes', 'Brenda'],
  american: ['Jordan', 'Kathryn', 'Annie', 'Kelsey', 'Haleigh', 'Chiaka', 'Justine', 'Avery', 'Khalia', 'Andrea', 'Jordyn', 'Megan', 'Lauren', 'Taylor', 'Madison', 'Sarah', 'Emily', 'Kara', 'Danielle', 'Alexis'],
  cuban: ['Melissa', 'Gyselle', 'Ailama', 'Diaris', 'Heidy', 'Yamila', 'Wilma', 'Laritza', 'Yaneisy', 'Lianny', 'Mariela', 'Yadismary', 'Ana', 'Daymara', 'Yoana', 'Dayana', 'Liannes', 'Rachel', 'Kenia', 'Sulian'],
  japanese: ['Sarina', 'Mayu', 'Arisa', 'Nichika', 'Miwako', 'Yukiko', 'Kotona', 'Haruyo', 'Mizuki', 'Ai', 'Aki', 'Erika', 'Saori', 'Yuka', 'Nanami', 'Shiori', 'Rena', 'Kanami', 'Hikari', 'Misaki'],
  iranian: ['Mahsa', 'Zahra', 'Fatemeh', 'Maryam', 'Sara', 'Neda', 'Shiva', 'Parisa', 'Elham', 'Mina', 'Narges', 'Leila', 'Nazanin', 'Somayeh', 'Shirin', 'Yasaman', 'Mona', 'Pegah', 'Ladan', 'Negar'],
  chinese: ['Ting', 'Xinyue', 'Yingying', 'Ruoqi', 'Yuanyuan', 'Ni', 'Yanan', 'Wenhui', 'Mengjie', 'Xiaotong', 'Yunlu', 'Shuting', 'Ruixue', 'Danni', 'Jia', 'Yifan', 'Meng', 'Xue', 'Hongying', 'Lin'],
  korean: ['Yeon-koung', 'Hee-jin', 'Su-ji', 'So-young', 'Ji-yun', 'Hye-jin', 'Jeong-ah', 'Da-young', 'Jae-young', 'Ha-eun', 'Seo-yeon', 'Min-ji', 'Ji-woo', 'Eun-ji', 'Yu-na', 'Ye-rin', 'Hyun-ju', 'Bo-ram', 'Na-yeon', 'Yeon-kyung'],
  arabic: ['Nour', 'Mariam', 'Fatima', 'Aya', 'Salma', 'Yasmin', 'Hana', 'Layla', 'Rania', 'Dina', 'Farah', 'Sara', 'Amira', 'Hiba', 'Lina', 'Rim', 'Mona', 'Nada', 'Reem', 'Huda'],
  indian: ['Priya', 'Anjali', 'Pooja', 'Kavya', 'Divya', 'Sneha', 'Aishwarya', 'Meera', 'Nisha', 'Deepika', 'Shruti', 'Lakshmi', 'Ananya', 'Riya', 'Swati', 'Jyoti', 'Neha', 'Asha', 'Rekha', 'Sonia'],
  thai: ['Pleumjit', 'Wilavan', 'Onuma', 'Hattaya', 'Ajcharaporn', 'Pimpichaya', 'Chatchu-on', 'Thatdao', 'Malika', 'Nootsara', 'Kannika', 'Sasipaporn', 'Tichaya', 'Piyanut', 'Wipawee', 'Kuttika', 'Chitaporn', 'Supattra', 'Natthanicha', 'Pornpun'],
  african: ['Mercy', 'Grace', 'Esther', 'Faith', 'Joy', 'Christine', 'Edith', 'Sharon', 'Violet', 'Brackcides', 'Emmaculate', 'Leonida', 'Noel', 'Agripina', 'Gaëlle', 'Laetitia', 'Odile', 'Raïssa', 'Christelle', 'Mireille'],
};

/**
 * A surname as a woman carries it, where the language marks it: Polish
 * -ski becomes -ska; Czech takes -ová or -á; Russian, Ukrainian and
 * Bulgarian -ov, -ev and -in take an -a; Greek -os, -is and -as become -ou,
 * -i and -a; Latvian endings turn feminine.
 */
export function feminineSurname(group: string, last: string): string {
  switch (group) {
    case 'polish':
      return last.replace(/(sk|ck|dzk)i$/, '$1a');
    case 'czech':
      if (/ý$/.test(last)) return last.replace(/ý$/, 'á');
      if (/ěk$/.test(last)) return last.replace(/ěk$/, 'ňková');
      if (/ek$/.test(last)) return last.replace(/ek$/, 'ková');
      if (/ec$/.test(last)) return last.replace(/ec$/, 'cová');
      if (/a$/.test(last)) return last.replace(/a$/, 'ová');
      return `${last}ová`;
    case 'russian':
    case 'bulgarian':
    case 'ukrainian':
      if (/(ov|ev|in)$/.test(last)) return `${last}a`;
      if (/skyi$/.test(last)) return last.replace(/skyi$/, 'ska');
      return last;
    case 'greek':
      if (/os$/.test(last)) return last.replace(/os$/, 'ou');
      if (/is$/.test(last)) return last.replace(/is$/, 'i');
      if (/as$/.test(last)) return last.replace(/as$/, 'a');
      return last;
    case 'latvian':
      if (/š$/.test(last)) return last.replace(/š$/, 'a');
      if (/is$/.test(last)) return last.replace(/is$/, 'e');
      if (/s$/.test(last)) return last.replace(/s$/, 'a');
      return last;
    default:
      return last;
  }
}

const WOMEN_BANKS = new Map<string, NameBank>();

/** The name bank of a group — the women's, in the women's game. */
export function bankFor(group: string, women = false): NameBank {
  const key = NAME_BANKS[group] !== undefined ? group : DEFAULT_NAME_GROUP;
  const men = NAME_BANKS[key];
  if (!women) return men;
  let bank = WOMEN_BANKS.get(key);
  if (bank === undefined) {
    bank = { first: WOMEN_FIRST[key] ?? WOMEN_FIRST[DEFAULT_NAME_GROUP], last: men.last.map((l) => feminineSurname(key, l)) };
    WOMEN_BANKS.set(key, bank);
  }
  return bank;
}
