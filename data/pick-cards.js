const fs = require("fs");

const cards = JSON.parse(fs.readFileSync("cards.json", "utf8"));


// const toPick =
// [

// [17,"Obsession"],
// [1,"The Tournament Faction"],

// [2,"Lugubrious Finger Trap"],
// [2,"Ominous Oozling"],
// [2,"12 Man Brunch of Doom"],
// [2,"Forget"],
// [2,"Quotidian Ejector"],
// [2,"Sneaking Spitspider"],
// [2,"Compulsive Creeper"],
// [1,"Voidal Observatory"],
// [2,"Ritual of the Screaming Cheese"],
// [2,"Servile Centipede"],
// [2,"Quotidian Assassination"],
// [2,"Swarm of Gnats"],

// [1,"Mephitic Nullifier"],
// [1,"Napiform Protuberance"],
// [1,"Voidal Perversion"],
// [1,"Very Big Hat of Invisibility"],
// [1,"Arcana Experiment"],
// [1,"Remember"],
// [1,"Arcanist's Almanac"],
// [1,"Air Travel"],
// [1,"Spontaneous Displacement"],
// [1,"Stolen Inspiration"],
// [1,"Voidal Webbing"]
// ];


const toPick = [

[18, "Rage"],
[1, "The Tournament Faction"],

[1, "Heirloom Incinerator"],
[1, "Cannon Squadron"],
[1, "Bloodcurdling Bulldozer"],
[1, "Arena Quarter-Finalist"],
[1, "Plodding Brute"],
[1, "Target Practice"],
[1, "Raging Bask"],
[1, "Hammer Smash"],

[1, "Scout"],
[1, "Flaming Barfuse"],
[2, "Sleeping Guard"],
[2, "Skewer"],
[2, "Oversoon Lightfoot"],
[2, "Kettinger"],
[2, "Eye Gouge"],
[2, "Dragon Juice"],
[2, "Dragon's Strategy"],
[2, "Creaky Old Swordsman"],

[2, "Cratered Deputy"],
[1, "Hidden Sniper"],
[1, "Stalwart Soldier"],
[1, "Strength In Numbers"],
[1, "Dragon's Anthem"],
[1, "Berserker Corps"],

]


const output = toPick.reduce((acc, [count, name])=>{
  const card = cards.find(x => x.name === name);
  for(let i = 0; i < count; i++){
    acc.push(card);
  }

  return acc;
}, []);


console.log(JSON.stringify(output));
