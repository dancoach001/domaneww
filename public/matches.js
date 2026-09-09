/* =====================================================
   MATCH STATE
===================================================== */

const state = {
    allMatches: []
};


/* =====================================================
   NORMALIZE TEAM NAME
===================================================== */

function normalizeTeamName(name = '') {

    return String(name)
        .replace(/&/g, ' and ')
        .replace(/[-_]+/g, ' ')
        .replace(/\bFootball Club\b/gi, '')
        .replace(/\bSports Club\b/gi, '')
        .replace(/\bFC\b/gi, '')
        .replace(/\bSC\b/gi, '')
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

}


/* =====================================================
   FORMAT DATE
===================================================== */

function formatDate(dateString) {

    if (!dateString) {
        return 'Date TBC';
    }

    const dateOnly = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (dateOnly) {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        return `${Number(dateOnly[3])} ${monthNames[Number(dateOnly[2]) - 1]} ${dateOnly[1]}`;
    }

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleDateString('en-NG', {

        day: 'numeric',
        month: 'long',
        year: 'numeric'

    });

}


/* =====================================================
   FORMAT TIME
===================================================== */

function formatTime(timeString) {

    if (!timeString) {
        return 'Time TBC';
    }

    return timeString;

}


/* =====================================================
   GET TEAM LOGO
===================================================== */

const teamLogoFiles = [
    'Abia Warriors FC.png',
    'Barau FC.png',
    'Bendel Insurance FC.png',
    'Doma United FC.png',
    'Enyimba FC.png',
    'Ikorodu City FC.png',
    'Inter Lagos.png',
    'Kano Pillars FC.png',
    'Katsina United FC.png',
    'Kun Khalifat FC.png',
    'Kwara United FC.png',
    'Nasarawa United FC.png',
    'Niger Tornadoes FC.png',
    'Plateau United FC.png',
    'Ranchers Bees.png',
    'Rangers International FC.png',
    'Rivers United FC.png',
    'Shooting Stars Sports Club (3SC).png',
    'Sporting Lagos FC.png',
    'Warri Wolves.png'
];

const teamLogoLookup = new Map();

teamLogoFiles.forEach(function(filename) {

    const teamName = filename.replace(/\.png$/i, '');
    const normalized = normalizeTeamName(teamName);

    if (!teamLogoLookup.has(normalized)) {

        teamLogoLookup.set(
            normalized,
            `images/${encodeURIComponent(filename)}`
        );

    }

});

function getTeamLogo(teamName) {

    const normalized = normalizeTeamName(teamName);

    return teamLogoLookup.get(normalized) || null;

}


/* =====================================================
   CREATE TEAM HTML
===================================================== */

function createTeamHTML(teamName) {

    const logo = getTeamLogo(teamName);

    const initials = (teamName || 'T')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(word => word.charAt(0))
        .join('')
        .toUpperCase();


    return `

        <div class="team">

            ${
                logo

                ?

                `
                <img
                    src="${logo}"
                    alt="${teamName}"
                >
                `

                :

                `
                <div class="opponent-logo">
                    ${initials}
                </div>
                `
            }

            <span>
                ${teamName || 'Team TBC'}
            </span>

        </div>

    `;

}


/* =====================================================
   CREATE MATCH CARD
===================================================== */

function createMatchCard(match) {

    const status = String(match.status || '').toLowerCase();

    const isFinished =
        status === 'finished';

    const homeScore =
        match.score && match.score.home !== undefined
            ? match.score.home
            : '?';

    const awayScore =
        match.score && match.score.away !== undefined
            ? match.score.away
            : '?';


    const score = `${homeScore} - ${awayScore}`;


    const statusText = isFinished
        ? 'Full Time'
        : status === 'postponed'
            ? 'Postponed'
            : 'Upcoming';


    const statusClass = isFinished
        ? 'finished'
        : 'upcoming';


    return `

        <article class="match-card">

            <!-- DATE -->

            <div class="match-date">

                <span>DATE</span>

                <strong>
                    ${formatDate(match.date)}
                </strong>

            </div>


            <!-- TEAMS -->

            <div class="teams">

                ${createTeamHTML(match.homeTeam)}


                <!-- SCORE -->

                <div class="score">

                    ${
                        isFinished
                            ? '<small>FULL TIME</small>'
                            : ''
                    }

                    ${score}

                </div>


                ${createTeamHTML(match.awayTeam)}

            </div>


            <!-- MATCH INFORMATION -->

            <div class="match-info">

                ${
                    match.matchday
                    ?
                    `<strong>${match.matchday}</strong>`
                    :
                    ''
                }


                ${
                    match.venue
                    ?
                    `<span>📍 ${match.venue}</span>`
                    :
                    ''
                }


                ${
                    match.time
                    ?
                    `<span>🕒 ${formatTime(match.time)}</span>`
                    :
                    ''
                }


                <br>


                <span class="status ${statusClass}">
                    ${statusText}
                </span>

            </div>

        </article>

    `;

}


/* =====================================================
   RENDER MATCHES
===================================================== */

function isCompletedMatch(match) {

    const status = String(match.status || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const completedStatuses = [
        'finished',
        'completed',
        'ft',
        'full time'
    ];

    if (!completedStatuses.includes(status)) {
        return false;
    }

    if (!match.date) {
        return true;
    }

    const scheduledDate = new Date(
        `${match.date}T${match.time || '23:59'}:00`
    );

    return Number.isNaN(scheduledDate.getTime()) ||
        scheduledDate.getTime() <= Date.now();

}

function renderMatches() {

    const fixturesContainer =
        document.getElementById('fixturesList');

    const resultsContainer =
        document.getElementById('resultsList');


    if (!fixturesContainer || !resultsContainer) {

        console.error(
            'fixturesList or resultsList was not found.'
        );

        return;

    }


    /*
       Separate fixtures and results
    */

    const fixtures =
        state.allMatches.filter(match => {

            return !isCompletedMatch(match);

        });


    const results =
        state.allMatches.filter(match => {

            return isCompletedMatch(match);

        });


    /* =================================================
       FIXTURES
    ================================================= */

    if (!fixtures.length) {

        fixturesContainer.innerHTML = `

            <div class="empty-state">

                No upcoming NPFL fixtures found.

            </div>

        `;

    } else {

        fixturesContainer.innerHTML =
            fixtures
                .map(createMatchCard)
                .join('');

    }


    /* =================================================
       RESULTS
    ================================================= */

    if (!results.length) {

        resultsContainer.innerHTML = `

            <div class="empty-state">

                No completed NPFL results found.

            </div>

        `;

    } else {

        resultsContainer.innerHTML =
            results
                .map(createMatchCard)
                .join('');

    }

}


/* =====================================================
   LOAD NPFL MATCHES
===================================================== */

async function loadMatches() {

    const fixturesContainer =
        document.getElementById('fixturesList');

    const resultsContainer =
        document.getElementById('resultsList');


    /*
       Loading message
    */

    if (fixturesContainer) {

        fixturesContainer.innerHTML = `

            <div class="empty-state">

                Loading NPFL fixtures...

            </div>

        `;

    }


    if (resultsContainer) {

        resultsContainer.innerHTML = `

            <div class="empty-state">

                Loading NPFL results...

            </div>

        `;

    }


    try {

        console.log('Fetching NPFL matches...');


        const response =
            await fetch('/api/npfl/matches');


        const data =
            await response.json();


        console.log('NPFL API response:', data);


        if (!response.ok || !data.success) {

            throw new Error(

                data.error ||
                'Unable to load NPFL matches.'

            );

        }


        /*
           Make sure matches is an array
        */

        const matches =
            Array.isArray(data.matches)
                ? data.matches
                : [];


        state.allMatches = matches;


        console.log(
            'Doma United Matchday 2:',
            state.allMatches.filter(match =>
                String(match.matchday).includes('2') &&
                (
                    String(match.homeTeam).toLowerCase().includes('doma') ||
                    String(match.awayTeam).toLowerCase().includes('doma')
                )
            )
        );


        console.log(
            `Loaded ${matches.length} NPFL matches.`
        );


        /*
           Render everything
        */

        renderMatches();


    } catch (error) {

        console.error(
            'NPFL loading error:',
            error
        );


        const errorHTML = `

            <div class="empty-state">

                Unable to load NPFL matches right now.

                <br><br>

                <small>
                    ${error.message}
                </small>

            </div>

        `;


        if (fixturesContainer) {

            fixturesContainer.innerHTML =
                errorHTML;

        }


        if (resultsContainer) {

            resultsContainer.innerHTML =
                errorHTML;

        }

    }

}


/* =====================================================
   FIXTURES / RESULTS TABS
===================================================== */

function showMatches(section, button) {

    /*
       Hide both sections
    */

    document
        .querySelectorAll('.match-section')
        .forEach(function(item) {

            item.classList.add('hidden');

        });


    /*
       Show selected section
    */

    const selected =
        document.getElementById(section);


    if (selected) {

        selected.classList.remove('hidden');

    }


    /*
       Remove active state
    */

    document
        .querySelectorAll('.match-tab')
        .forEach(function(tab) {

            tab.classList.remove('active');

        });


    /*
       Activate clicked tab
    */

    if (button) {

        button.classList.add('active');

    }

}


/* =====================================================
   MOBILE MENU
===================================================== */

function initMobileMenu() {

    const menuToggle =
        document.querySelector('.menu-toggle');

    const navLinks =
        document.querySelector('.nav-links');


    if (!menuToggle || !navLinks) {
        return;
    }


    menuToggle.addEventListener(
        'click',
        function() {

            navLinks.classList.toggle('open');

        }
    );

}


/* =====================================================
   CURRENT YEAR
===================================================== */

function initYear() {

    const year =
        document.getElementById('year');


    if (year) {

        year.textContent =
            new Date().getFullYear();

    }

}

async function updateLiveNavigation() {
    const liveLink = document.querySelector('.nav-links a[href="live.html"]');
    if (!liveLink) return;

    try {
        const response = await fetch('/api/live-streams');
        const data = await response.json();
        if (response.ok && data.success && data.active) {
            liveLink.textContent = 'LIVE';
            liveLink.classList.add('live-nav-link');
            liveLink.setAttribute('aria-label', 'Live broadcast available');
        }
    } catch (error) {}
}


/* =====================================================
   INITIALIZE
===================================================== */

document.addEventListener(
    'DOMContentLoaded',
    function() {

        loadMatches();
        updateLiveNavigation();

        // Real-time synchronization across devices and browsers
        try {
            const eventSource = new EventSource('/api/events');
            eventSource.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data && data.type === 'matches') {
                        loadMatches();
                    }
                } catch (e) {}
            };
        } catch (e) {}

    }
);


