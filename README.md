# Waarschuwing
Dit is een dahsboard maker voor je whatsapp chats. Deze tool is extreem hevig gevibecode, maar gebruikt geen externe api's en dergelijke, t laad alleen wat libraries in, maar is vgm vrij private. 

## Stap 1
Om de tool te runnen, zul je eerst je chat op whatsapp moeten exporten.

|![whatsapp_export_1](https://github.com/user-attachments/assets/31cacc53-a5e1-42a0-aa7d-7b36c311796b)|![whatsapp_export_2](https://github.com/user-attachments/assets/0dddb310-18a2-48a5-bedb-fde181d89fc2)|![whatsapp_export_3](https://github.com/user-attachments/assets/ce5d3423-f09e-4114-b5bb-af3b8ebc071f)|
|:--:|:--:|:--:|
|Click the 3 dots in the top right of your screen|Click on "More"|Click on without media|

## Stap 2
Open je terminal (CMD)
Ga naar de plek waar je je folder voor dit project wil hebben.

Voor mij is dat in mn documents folder, dus:
```bash
cd Documents
```

Ren de git clone command:
```bash
git clone https://github.com/ElmoNeedsArson/Whatsapp-Report.git
```
P.S. Als dit niet werkt kan je ook handmatig de zip van de code downloaded van github, en dan zelf in vs code openen. 

Ga in de folder:
```bash
cd Whatsapp-Report
```

Download de libraries:
```
npm install
```

Open de folder in vs code, door dit te typen:
```bash
code .
```

## Stap 3
Eenmaal in vscode zijn we er bijna. Je wilt de vscode terminal openen.
<img width="1417" height="1011" alt="image" src="https://github.com/user-attachments/assets/22229d07-c5b8-46f5-8ff8-66f4dbd4f0ba" />
De blauwe balk, helemaal onder in het scherm kan je omhoog trekken. Dan ziet het er zo uit:
<img width="1427" height="964" alt="image" src="https://github.com/user-attachments/assets/3d866da6-0968-4826-a405-7844d09814ec" />
Switch naar terminal:
<img width="1429" height="938" alt="image" src="https://github.com/user-attachments/assets/e320c226-753d-4eb3-9940-81735b1a6d9a" />

Unzip je whatsapp export, en sleep je whatsapp export.txt bestand the vscode folder in, en rename de file naar een korter makkelijkere naam, ik doe vaak chat.txt

na je dat gedaan hebt ren deze command:
```bash
node whatsapp_report.js chat.txt --verbose
```

Als het goed is zie je links in je file tree nu een report.html bestand. Als je deze right clicked en dan de optie "open with live server" doet, zie je hem in de browser. Je kan hem ook gewoon dubbel klikken in je normale file explorer, dan opent ie automatisch in de browser 





