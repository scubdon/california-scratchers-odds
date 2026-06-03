
The old plan below includes the instructions for a maine scratch ticket site, can you make the California version of the site it describes (maine site is located in "maine lottery odds" directory if you need to reference anything from that. its actually a bit easier for california because the individual game pages have the odds of each prize already calculated. here's the page with the index of scratch ticket pages for california: https://www.calottery.com/en/scratchers
there is a table with top prize odds for the games on that page, but the individual game pages actually have more detailed data (odds of all individual prizes are included). essentially im just trying to present this data in a similar fashion as the data on the maine page.




---- Begin old plan ----
I want to provide a clearer way for people to see the actual odds of winning a large prize when they purchase scratch tickets in Maine. The current table of unclaimed prizes does not include a total tickets printed column, so the odds of winning one of the top prizes (based on the percent unsold and the number of each prize remaining), can't be calculated from that table alone. I want you to help with aggregating the needed data and presenting and visualizing it (if possible) it via the web. Here is some relevant information to help you get started.

The maine state lottery website has a table of unclaimed prizes for their instant games (scratch tickets) at https://www.mainelottery.com/players_info/unclaimed_prizes.html. This table includes the following columns:


- Price Point (cost of game)
- Game No. (id of the specific game)
- Game Name 
- Percent Unsold (number of printed tickets still available for purchase)
- Total Unclaimed (total $ of prizes yet to be redeemed)
- Top Prize Level(s) (levels of prizes - note: these are recorded in nested rows where multiple prizes after the top one are on their own rows where everything other than prize level and top prizes unclaimed is null - forward-filling or pivoting would probably be necessary)
- Top Prize(s) Unclaimed - number of top prizes yet to be redeemed



The site also has pages for each game, which is where you can find the number of tickets printed in total for that game (some games from the table are missing, as they seem to remove their pages after a specified timeframe). the links for which can be found via the index linked at https://www.mainelottery.com/instant/index.html. The index includes links to pages with collections of links to games by price point (e.g. https://www.mainelottery.com/instant/scratch10dollar.html - points to page with links to all $10 games). The individual game pages include an image of the ticket, the game number (id), and the total tickets printed.


I would like to have a page that showed all the games from the table that could be matched to individual game pages (including the images of the tickets) and for each game, show the odds of winning the top prizes listed on the table calculated using the number of prizes at that level remaining out of the total tickets remaining for purchase (which would be calculated using the percent unsold value from the table and the total tickets printed from each game's page). so, each game would have it's top prizes listed and the odds of winning each of those prizes (e.g. 1 in 4,000). ultimately the goal is to help people realize how remote a chance they have at actually winning a prize worth more than the cost of the ticket. 

---- End old plan ----
