// The sample boards that ship with the game. Every clue here was written for this
// project: general knowledge, bar-friendly, short enough to read out. Venues write their
// own boards in the admin; these are a starting point and a demo.

import type { Board, Category, LastCallClue } from "./board.js";

type Row = [clue: string, answer: string];
const cat = (name: string, rows: Row[]): Category => ({ name, clues: rows.map(([clue, answer]) => ({ clue, answer })) });
const last = (category: string, clue: string, answer: string): LastCallClue => ({ category, clue, answer });

const pubNight: Board = {
  id: "sample-pub-night",
  title: "Pub Night Starter",
  rounds: [
    {
      categories: [
        cat("On the Map", [
          ["This European country is shaped like a boot.", "Italy"],
          ["Canada's capital city.", "Ottawa"],
          ["The largest river in South America by volume.", "The Amazon"],
          ["The only continent with no countries.", "Antarctica"],
          ["Nairobi is the capital of this African country.", "Kenya"],
        ]),
        cat("Behind the Bar", [
          ["The spirit in a classic mojito.", "Rum"],
          ["The citrus juice in a margarita.", "Lime"],
          ["Beer's bitterness comes from the flowers of this plant.", "Hops"],
          ["A martini's classic garnish is a lemon twist or one of these.", "An olive"],
          ["Tequila is made from this plant.", "Blue agave"],
        ]),
        cat("Animal Kingdom", [
          ["The largest animal alive today.", "The blue whale"],
          ["A group of lions is called this.", "A pride"],
          ["The only mammals that truly fly.", "Bats"],
          ["An octopus has this many hearts.", "Three"],
          ["This seabird has the widest wingspan of any living bird.", "The wandering albatross"],
        ]),
        cat("Science Class", [
          ["H2O is better known as this.", "Water"],
          ["It's called the Red Planet.", "Mars"],
          ["Plants take in this gas from the air.", "Carbon dioxide"],
          ["The hardest natural substance.", "Diamond"],
          ["Au is the chemical symbol for this metal.", "Gold"],
        ]),
        cat("Game Night", [
          ["A standard deck has this many cards, not counting jokers.", "52"],
          ["In eight-ball pool, the ball you sink last.", "The 8 ball"],
          ["A chessboard has this many squares.", "64"],
          ["In bowling, three strikes in a row.", "A turkey"],
          ["In poker, five cards of the same suit.", "A flush"],
        ]),
      ],
    },
    {
      categories: [
        cat("At the Movies", [
          ["This 1997 film is about a ship that sank in 1912.", "Titanic"],
          ["He directed Jaws, E.T. and Jurassic Park.", "Steven Spielberg"],
          ["The first feature-length film animated entirely by computer, released in 1995.", "Toy Story"],
          ["The fictional African nation that is home to the Black Panther.", "Wakanda"],
          ["In 1929 this silent war film won the very first Academy Award for best picture.", "Wings"],
        ]),
        cat("Turn It Up", [
          ["A standard guitar has this many strings.", "Six"],
          ["John, Paul, George and Ringo were this band.", "The Beatles"],
          ["He was known as the King of Pop.", "Michael Jackson"],
          ["This Italian composer wrote The Four Seasons.", "Antonio Vivaldi"],
          ["Marked ff in sheet music, this Italian word means very loud.", "Fortissimo"],
        ]),
        cat("On the Plate", [
          ["The main ingredient of guacamole.", "Avocado"],
          ["The cheese on a traditional Margherita pizza.", "Mozzarella"],
          ["By weight, the world's most expensive spice.", "Saffron"],
          ["Sushi rice is seasoned with this kind of vinegar.", "Rice vinegar"],
          ["This thin pasta's name means little worms.", "Vermicelli"],
        ]),
        cat("Way Back When", [
          ["The first person to walk on the Moon.", "Neil Armstrong"],
          ["The ship that carried the Pilgrims to America in 1620.", "The Mayflower"],
          ["A wall dividing this German city came down in 1989.", "Berlin"],
          ["The only one of the seven ancient wonders still standing.", "The Great Pyramid of Giza"],
          ["The year traditionally given for the fall of the Western Roman Empire.", "476"],
        ]),
        cat("Good Sports", [
          ["A soccer team has this many players on the field.", "Eleven"],
          ["Love, deuce and advantage are scores in this sport.", "Tennis"],
          ["The Tour de France traditionally finishes in this city.", "Paris"],
          ["A marathon is this many miles, to the nearest whole mile.", "26"],
          ["The only country to play in every men's soccer World Cup.", "Brazil"],
        ]),
      ],
    },
  ],
  lastCall: last("The Night Sky", "The brightest star in the night sky.", "Sirius"),
};

const quickRound: Board = {
  id: "sample-quick-round",
  title: "Quick Round",
  rounds: [
    {
      categories: [
        cat("Word Nerd", [
          ["The plural of goose.", "Geese"],
          ["The most used letter in English.", "E"],
          ["A word that reads the same forwards and backwards.", "A palindrome"],
          ["The fear of spiders.", "Arachnophobia"],
          ["A sentence that uses every letter of the alphabet.", "A pangram"],
        ]),
        cat("By the Numbers", [
          ["A hexagon has this many sides.", "Six"],
          ["The number of items in a baker's dozen.", "13"],
          ["The Roman numeral for 50.", "L"],
          ["The only even prime number.", "Two"],
          ["The first four digits of pi after the decimal point.", "1415"],
        ]),
        cat("Body Parts", [
          ["The organ that pumps your blood.", "The heart"],
          ["A full set of adult teeth has this many.", "32"],
          ["The body's largest organ.", "The skin"],
          ["The three smallest bones in the body are in this organ.", "The ear"],
          ["The body's largest artery.", "The aorta"],
        ]),
        cat("Bright Ideas", [
          ["Alexander Graham Bell is credited with inventing this.", "The telephone"],
          ["Around 1440, Johannes Gutenberg built this machine.", "The printing press"],
          ["The Wright brothers first flew a powered plane in this US state.", "North Carolina"],
          ["Tim Berners-Lee invented this in 1989.", "The World Wide Web"],
          ["A unit of power is named after this Scottish improver of the steam engine.", "James Watt"],
        ]),
        cat("True Colors", [
          ["Mix blue and yellow paint and you get this.", "Green"],
          ["The primary colors of light are red, green and this.", "Blue"],
          ["In the rainbow's traditional seven colors, it sits between blue and violet.", "Indigo"],
          ["An aircraft's black box is actually this color.", "Orange"],
          ["This royal dye color, named for the city of Tyre, was once made from sea snails.", "Purple"],
        ]),
      ],
    },
  ],
  lastCall: last("Capital Cities", "The capital city of Australia.", "Canberra"),
};

const foodAndDrink: Board = {
  id: "sample-food-and-drink",
  title: "Food & Drink Night",
  rounds: [
    {
      categories: [
        cat("Beer Me", [
          ["Munich's famous beer festival.", "Oktoberfest"],
          ["Beer's four classic ingredients are water, malt, hops and this.", "Yeast"],
          ["IPA stands for this.", "India Pale Ale"],
          ["A dark Irish style of beer made with roasted barley.", "Stout"],
          ["The German name of Bavaria's 1516 beer purity law.", "The Reinheitsgebot"],
        ]),
        cat("Wine Time", [
          ["Chardonnay grapes make wine of this color.", "White"],
          ["The French region that gave sparkling wine its most famous name.", "Champagne"],
          ["A restaurant's trained wine expert.", "A sommelier"],
          ["Spain's best-known sparkling wine.", "Cava"],
          ["Chianti comes from this Italian region.", "Tuscany"],
        ]),
        cat("Shaken or Stirred", [
          ["Vodka and orange juice.", "A screwdriver"],
          ["Vodka, tomato juice and spices: a brunch classic.", "A Bloody Mary"],
          ["Rum, coconut cream and pineapple juice.", "A piña colada"],
          ["Equal parts gin, Campari and sweet vermouth.", "A Negroni"],
          ["Brazil's national cocktail: cachaça, lime and sugar.", "A caipirinha"],
        ]),
        cat("Coffee & Tea", [
          ["Tea drinking began in this country.", "China"],
          ["Espresso, steamed milk and foam, named after an order of friars.", "A cappuccino"],
          ["This tea is flavored with oil of bergamot.", "Earl Grey"],
          ["Japan's powdered green tea.", "Matcha"],
          ["The two main kinds of coffee bean are arabica and this.", "Robusta"],
        ]),
        cat("World Kitchen", [
          ["Paella comes from this country.", "Spain"],
          ["A dip made from chickpeas and tahini.", "Hummus"],
          ["Korea's staple dish of fermented cabbage.", "Kimchi"],
          ["The Japanese word for the savory fifth taste.", "Umami"],
          ["This French beef stew, braised in red wine, is named after Burgundy.", "Beef bourguignon"],
        ]),
        cat("Sweet Stuff", [
          ["Bees make it.", "Honey"],
          ["Canada is famous for syrup from this tree.", "The maple"],
          ["Chocolate is made from the seeds of this tree.", "The cacao tree"],
          ["The Italian dessert of coffee-soaked ladyfingers and mascarpone.", "Tiramisu"],
          ["A French custard with a hard top of caramelized sugar.", "Crème brûlée"],
        ]),
      ],
    },
  ],
  lastCall: last("Spirits", "By US law, bourbon's mash must be at least 51 percent this grain.", "Corn"),
};

export const SAMPLE_BOARDS: readonly Board[] = [pubNight, quickRound, foodAndDrink];
