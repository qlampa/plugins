(function () {
	'use strict';

	const hostAddress = 'http://smotret24.ru/';
	const availableBalancers = ['kinotochka', 'kinopub', 'lumex', 'filmix', 'filmixtv', 'fxapi', 'redheadsound', 'animevost', 'animego', 'animedia', 'animebesst', 'anilibria', 'rezka', 'rhsprem', 'kodik', 'remux', 'animelib', 'kinoukr', 'rc/filmix', 'rc/fxapi', 'rc/rhs', 'vcdn', 'lumex', 'collaps', 'collaps-dash', 'hdvb', 'mirage', 'alloha'];

	if (!window.rch) {
		Lampa.Utils.putScript(["https://qlampa.github.io/plugins/invc-rch.js"], () => { }, false, () => {
			if (!window.rch.startTypeInvoke)
				window.rch.typeInvoke('http://smotret24.ru', () => { });
		}, true);
	}

	var hubConnection;
	var hubTimer;
	function rchInvoke(json, call) {
		if (hubConnection) {
			clearTimeout(hubTimer);
			hubConnection.stop();
			hubConnection = null;
		}

		hubConnection = new signalR.HubConnectionBuilder().withUrl(json.ws).build();
		hubConnection.start().then(() => {
			window.rch.Registry(json.result, hubConnection, call);
		}).catch((err) => {
			Lampa.Noty.show(err.toString());
		});

		if (json.keepalive > 0) {
			hubTimer = setTimeout(() => {
				hubConnection.stop();
				hubConnection = null;
			}, 1000 * json.keepalive);
		}
	}

	function rchRun(json, call) {
		if (signalR === undefined)
			Lampa.Utils.putScript(["https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/6.0.25/signalr.js"], () => { }, false, () => {
				rchInvoke(json, call);
			}, true);
		else
			rchInvoke(json, call);
	}

	function account(url) {
		function getIP(callback) {
			let xhr = new XMLHttpRequest();
			xhr.open('GET', 'https://api.ipify.org?format=json', true);
			xhr.onreadystatechange = () => {
				if (xhr.readyState === 4) {
					if (xhr.status === 200) {
						try {
							let data = JSON.parse(xhr.responseText);
							callback(null, data.ip);
						}
						catch (err) {
							callback('Ошибка парсинга JSON', null);
						}
					}
					else
						callback('Ошибка запроса: ' + xhr.status, null);
				}
			};
			xhr.onerror = () => {
				callback('Ошибка сети', null);
			};
			xhr.send();
		}

		url = url + '';

		if (url.indexOf('account_email=') == -1) {
			let email = Lampa.Storage.get('account_email');
			if (email)
				url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
		}

		if (url.indexOf('uid=') == -1) {
			let uid = Lampa.Storage.get('lampac_unic_id', '');
			if (!uid) {
				uid = Lampa.Utils.uid(8).toLowerCase();
				Lampa.Storage.set('lampac_unic_id', uid);
			}
			if (uid)
				url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
		}

		if (url.indexOf('token=') == -1) {
			let token = '';
			if (token != '')
				url = Lampa.Utils.addUrlComponent(url, 'token=');
		}

		if (Lampa.Storage.get('user_ip') == '' && !Lampa.Storage.get('user_ip')) {
			getIP((error, ip) => {
				if (!error && ip) {
					Lampa.Storage.set("user_ip", ip);
				}
			});
		}

		if (Lampa.Storage.get('user_ip'))
			url = Lampa.Utils.addUrlComponent(url, 'user_ip=' + Lampa.Storage.get('user_ip'));

		return url;
	}

	function QWatchComponent(object) {
		let network = new Lampa.Reguest();
		let scroll = new Lampa.Scroll({
			mask: true,
			over: true
		});
		let files = new Lampa.Explorer(object);
		let filter = new Lampa.Filter(object);

		let sources = {};
		let last;
		let activeSourceUrl;
		let activeBalancer;
		let initialized;
		let balancer_timer;
		let images = [];
		let number_of_requests = 0;
		let number_of_requests_timer;
		let life_wait_times = 0;
		let life_wait_timer;

		let filter_sources = {};
		let filter_translate = {
			season: Lampa.Lang.translate('torrent_serial_season'),
			voice: Lampa.Lang.translate('torrent_parser_voice'),
			source: Lampa.Lang.translate('settings_rest_source')
		};
		let filter_find = {
			season: [],
			voice: []
		};

		function getBalancerName(entryJson) {
			return (entryJson.balanser || entryJson.name.split(' ')[0]).toLowerCase();
		}

		function clarificationSearchAdd(value) {
			var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var all = Lampa.Storage.get('clarification_search', '{}');
			all[id] = value;
			Lampa.Storage.set('clarification_search', all);
		}

		function clarificationSearchDelete() {
			var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var all = Lampa.Storage.get('clarification_search', '{}');
			delete all[id];
			Lampa.Storage.set('clarification_search', all);
		}

		function clarificationSearchGet() {
			var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			var all = Lampa.Storage.get('clarification_search', '{}');
			return all[id];
		}

		this.initialize = function () {
			let self = this;
			this.setLoading(true);

			filter.onSearch = (value) => {
				clarificationSearchAdd(value);

				Lampa.Activity.replace({
					search: value,
					clarification: true,
					similar: true
				});
			};
			filter.onBack = () => {
				self.start();
			};

			filter.render().find('.selector').on('hover:enter', () => {
				clearInterval(balancer_timer);
			});
			filter.render().find('.filter--search').appendTo(filter.render().find('.torrent-filter'));

			filter.onSelect = (type, a, b) => {
				if (type == 'filter') {
					if (a.reset) {
						clarificationSearchDelete();

						self.replaceChoice({
							season: 0,
							voice: 0,
							voice_url: '',
							voice_name: ''
						});
						setTimeout(() => {
							Lampa.Select.close();
							Lampa.Activity.replace({
								clarification: 0,
								similar: 0
							});
						}, 10);
					}
					else {
						let url = filter_find[a.stype][b.index].url;
						let choice = self.getChoice();
						if (a.stype == 'voice') {
							choice.voice_name = filter_find.voice[b.index].title;
							choice.voice_url = url;
						}
						choice[a.stype] = b.index;
						self.saveChoice(choice);
						self.reset();
						self.request(url);
						setTimeout(Lampa.Select.close, 10);
					}
				}
				else if (type == 'sort') {
					Lampa.Select.close();
					object.lampac_custom_select = a.source;
					self.changeBalancer(a.source);
				}
			};
			if (filter.addButtonBack)
				filter.addButtonBack();
			filter.render().find('.filter--sort span').text(Lampa.Lang.translate('qwatch_balancer'));
			scroll.body().addClass('torrent-list');

			files.appendFiles(scroll.render());
			files.appendHead(filter.render());
			scroll.minus(files.render().find('.explorer__files-head'));
			scroll.body().append(Lampa.Template.get('qwatch_page_content_loader'));

			Lampa.Controller.enable('content');
			this.setLoading(false);
			if (object.balancer) {
				files.render().find('.filter--search').remove();
				sources = {};
				sources[object.balancer] = { name: object.balancer };
				activeBalancer = object.balancer;
				filter_sources = [];

				return network["native"](account(object.url.replace('rjson=', 'nojson=')), this.parse.bind(this), function () {
					files.render().find('.torrent-filter').remove();
					self.showEmptyPage();
				}, false, {
					dataType: 'text'
				});
			}
			this.externalids().then(() => {
				return self.createSource();
			}).then((json) => {
				if (!availableBalancers.find((balancer) => {
					return activeBalancer.slice(0, balancer.length) == balancer;
				})) {
					filter.render().find('.filter--search').addClass('hide');
				}
				self.search();
			}).catch((err) => {
				self.showNoConnectPage(err);
			});
		};
		this.rch = function (json, noReset) {
			let self = this;
			rchRun(json, () => {
				if (!noReset)
					self.find();
				else
					noReset();
			});
		};
		this.externalids = function () {
			return new Promise((resolve, reject) => {
				if (!object.movie.imdb_id || !object.movie.kinopoisk_id) {
					let query = [];
					query.push('id=' + object.movie.id);
					query.push('serial=' + (object.movie.name ? 1 : 0));

					if (object.movie.imdb_id)
						query.push('imdb_id=' + (object.movie.imdb_id || ''));
					if (object.movie.kinopoisk_id)
						query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));

					network.timeout(10000);
					network.silent(account(hostAddress + 'externalids?' + query.join('&')), (externalJson) => {
						for (let i in externalJson)
							object.movie[i] = externalJson[i];

						resolve();
					}, resolve);
				}
				else
					resolve();
			});
		};
		this.updateBalancer = function (balancerName) {
			let lastBalancer = Lampa.Storage.cache('online_last_balanser', 200, {});
			lastBalancer[object.movie.id] = balancerName;
			Lampa.Storage.set('online_last_balanser', lastBalancer);
		};
		this.changeBalancer = function (balancerName) {
			this.updateBalancer(balancerName);
			Lampa.Storage.set('online_balanser', balancerName);
			let newChoice = this.getChoice(balancerName);
			let lastChoice = this.getChoice();
			if (lastChoice.voice_name)
				newChoice.voice_name = lastChoice.voice_name;
			this.saveChoice(newChoice, balancerName);
			Lampa.Activity.replace();
		};
		this.requestParams = function (url) {
			let query = [];
			query.push('id=' + object.movie.id);
			if (object.movie.imdb_id) query.push('imdb_id=' + (object.movie.imdb_id || ''));
			if (object.movie.kinopoisk_id) query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));
			query.push('title=' + encodeURIComponent(object.clarification ? object.search : object.movie.title || object.movie.name));
			query.push('original_title=' + encodeURIComponent(object.movie.original_title || object.movie.original_name));
			query.push('serial=' + (object.movie.name ? 1 : 0));
			query.push('original_language=' + (object.movie.original_language || ''));
			query.push('year=' + ((object.movie.release_date || object.movie.first_air_date || '0000') + '').slice(0, 4));
			query.push('source=' + (object.movie.source || 'tmdb')); //Lampa.Storage.field('source')
			query.push('rchtype=' + (window.rch ? window.rch.type : ''));
			query.push('clarification=' + (object.clarification ? 1 : 0));
			query.push('similar=' + (object.similar ? true : false));
			if (Lampa.Storage.get('account_email', ''))
				query.push('cub_id=' + Lampa.Utils.hash(Lampa.Storage.get('account_email', '')));
			return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
		};
		this.getLastChoiceBalancer = function () {
			let lastChoiceBalancer = Lampa.Storage.cache('online_last_balanser', 200, {});
			if (lastChoiceBalancer[object.movie.id])
				return lastChoiceBalancer[object.movie.id];
			else
				return Lampa.Storage.get('online_balanser', filter_sources.length ? filter_sources[0] : '');
		};
		this.startSource = function (sourcesJson) {
			return new Promise((resolve, reject) => {
				sourcesJson.forEach((entry) => {
					let sourceName = getBalancerName(entry);
					sources[sourceName] = {
						url: entry.url,
						name: entry.name,
						show: entry.show === undefined ? true : entry.show
					};
				});

				filter_sources = Lampa.Arrays.getKeys(sources);
				if (filter_sources.length) {
					let lastChoiceBalancer = Lampa.Storage.cache('online_last_balanser', 200, {});
					if (lastChoiceBalancer[object.movie.id])
						activeBalancer = lastChoiceBalancer[object.movie.id];
					else
						activeBalancer = Lampa.Storage.get('online_balanser', filter_sources[0]);

					if (!sources[activeBalancer] || (!sources[activeBalancer].show && !object.lampac_custom_select))
						activeBalancer = filter_sources[0];

					activeSourceUrl = sources[activeBalancer].url;
					resolve(sourcesJson);
				}
				else
					reject();
			});
		};
		this.lifeSource = function () {
			let self = this;
			return new Promise((resolve, reject) => {
				let url = self.requestParams(hostAddress + 'lifeevents?memkey=' + (self.memkey || ''));
				let red = false;
				let gou = (targetJson, any) => {
					if (targetJson.accsdb)
						return reject(targetJson);

					let lastBalancer = self.getLastChoiceBalancer();
					if (!red) {
						let _filter = targetJson.online.filter((c) => {
							return (any ? c.show : (c.show && c.name.toLowerCase() == lastBalancer));
						});

						if (_filter.length) {
							red = true;
							resolve(targetJson.online.filter((c) => {
								return c.show;
							}));
						}
						else if (any)
							reject();
					}
				};

				network.timeout(3000);
				network.silent(account(url), (lifeSourcesJson) => {
					life_wait_times++;
					filter_sources = [];
					sources = {};
					lifeSourcesJson.online.forEach((entry) => {
						let sourceName = getBalancerName(entry);
						sources[sourceName] = {
							url: entry.url,
							name: entry.name,
							show: entry.show === undefined ? true : entry.show
						};
					});
					filter_sources = Lampa.Arrays.getKeys(sources);
					filter.set('sort', filter_sources.map((e) => {
						return {
							title: sources[e].name,
							source: e,
							selected: e == activeBalancer,
							ghost: !sources[e].show
						};
					}));
					filter.chosen('sort', [sources[activeBalancer] ? sources[activeBalancer].name : activeBalancer]);
					gou(lifeSourcesJson);
					let lastBalancer = self.getLastChoiceBalancer();
					if (life_wait_times > 15 || lifeSourcesJson.ready) {
						filter.render().find('.qwatch-balancer-loader').remove();
						gou(lifeSourcesJson, true);
					}
					else if (!red && sources[lastBalancer] && sources[lastBalancer].show) {
						gou(lifeSourcesJson, true);
						life_wait_timer = setTimeout(fin, 1000);
					}
					else
						life_wait_timer = setTimeout(fin, 1000);
				}, () => {
					life_wait_times++;
					if (life_wait_times > 15)
						reject();
					else
						life_wait_timer = setTimeout(fin, 1000);
				});
			});
		};
		this.createSource = function () {
			let self = this;
			return new Promise(function (resolve, reject) {
				let url = self.requestParams(hostAddress + 'lite/events?life=true');
				network.timeout(15000);
				network.silent(account(url), (targetJson) => {
					if (targetJson.accsdb)
						return reject(targetJson);

					if (targetJson.life) {
						self.memkey = targetJson.memkey;
						if (targetJson.title) {
							if (object.movie.name)
								object.movie.name = targetJson.title;
							if (object.movie.title)
								object.movie.title = targetJson.title;
						}
						filter.render().find('.filter--sort').append('<span class="qwatch-balancer-loader" style="width: 1.2em; height: 1.2em; margin-top: 0; background: url(./img/loader.svg) no-repeat 50% 50%; background-size: contain; margin-left: 0.5em"></span>');
						self.lifeSource().then(self.startSource).then(resolve).catch(reject);
					}
					else
						self.startSource(targetJson).then(resolve).catch(reject);
				}, reject);
			});
		};
		/**
		 * Подготовка
		 */
		this.create = function () {
			return this.render();
		};
		/**
		 * Начать поиск
		 */
		this.search = function () { //this.loading(true)
			this.filter({
				source: filter_sources
			}, this.getChoice());
			this.find();
		};
		this.find = function () {
			this.request(this.requestParams(activeSourceUrl));
		};
		this.request = function (url) {
			number_of_requests++;
			if (number_of_requests < 10) {
				network["native"](account(url), this.parse.bind(this), this.showNoAnswerPage.bind(this), false, {
					dataType: 'text'
				});
				clearTimeout(number_of_requests_timer);
				number_of_requests_timer = setTimeout(() => {
					number_of_requests = 0;
				}, 4000);
			}
			else
				this.showEmptyPage();
		};
		this.parseJsonData = function (jsonDataString, name) {
			try {
				let html = $('<div>' + jsonDataString + '</div>');
				let elements = [];
				html.find(name).each(function () {
					let item = $(this);
					let data = JSON.parse(item.attr('data-json'));
					let season = item.attr('s');
					let episode = item.attr('e');
					let text = item.text();
					if (!object.movie.name) {
						if (text.match(/\d+p/i)) {
							if (!data.quality) {
								data.quality = {};
								data.quality[text] = data.url;
							}
							text = object.movie.title;
						}
						if (text == 'По умолчанию') {
							text = object.movie.title;
						}
					}
					if (episode)
						data.episode = parseInt(episode);
					if (season)
						data.season = parseInt(season);
					if (text)
						data.text = text;
					data.active = item.hasClass('active');
					elements.push(data);
				});
				return elements;
			}
			catch (err) {
				return [];
			}
		};
		this.getFileUrl = function (file, call) {
			let self = this;

			if (Lampa.Storage.field('player') !== 'inner' && file.stream && Lampa.Platform.is('apple')) {
				var newfile = Lampa.Arrays.clone(file);
				newfile.method = 'play';
				newfile.url = file.stream;
				call(newfile, {});
			}
			else if (file.method == 'play')
				call(file, {});
			else {
				Lampa.Loading.start(() => {
					Lampa.Loading.stop();
					Lampa.Controller.toggle('content');
					network.clear();
				});
				network["native"](account(file.url), (json) => {
					if (json.rch) {
						self.rch(json, () => {
							Lampa.Loading.stop();
							self.getFileUrl(file, call);
						});
					}
					else {
						Lampa.Loading.stop();
						call(json, json);
					}
				}, function () {
					Lampa.Loading.stop();
					call(false, {});
				});
			}
		};
		this.toPlayElement = function (file) {
			return {
				title: file.title,
				url: file.url,
				quality: file.qualitys,
				timeline: file.timeline,
				subtitles: file.subtitles,
				callback: file.mark
			};
		};
		this.orUrlReserve = function (data) {
			if (data.url && typeof data.url == 'string' && data.url.indexOf(" or ") !== -1) {
				var urls = data.url.split(" or ");
				data.url = urls[0];
				data.url_reserve = urls[1];
			}
		};
		this.setDefaultQuality = function (data) {
			if (Lampa.Arrays.getKeys(data.quality).length) {
				for (let i in data.quality) {
					if (parseInt(i) == Lampa.Storage.field('video_quality_default')) {
						data.url = data.quality[i];
						this.orUrlReserve(data);
					}
					if (data.quality[i].indexOf(" or ") !== -1)
						data.quality[i] = data.quality[i].split(" or ")[0];
				}
			}
		};
		this.display = function (videos) {
			let self = this;
			this.draw(videos, {
				onEnter: (item, html) => {
					self.getFileUrl(item, (json, json_call) => {
						if (json && json.url) {
							let playlist = [];
							let first = self.toPlayElement(item);
							first.url = json.url;
							first.headers = json_call.headers || json.headers;
							first.quality = json_call.quality || item.qualitys;
							first.hls_manifest_timeout = json_call.hls_manifest_timeout || json.hls_manifest_timeout;
							first.subtitles = json.subtitles;
							first.vast_url = json.vast_url;
							first.vast_msg = json.vast_msg;
							self.orUrlReserve(first);
							self.setDefaultQuality(first);

							if (item.season) {
								videos.forEach((element) => {
									let cell = self.toPlayElement(element);
									if (element == item)
										cell.url = json.url;
									else if (element.method == 'call') {
										if (Lampa.Storage.field('player') !== 'inner') {
											cell.url = element.stream;
											delete cell.quality;
										}
										else {
											cell.url = (call) => {
												self.getFileUrl(element, (stream, stream_json) => {
													if (stream.url) {
														cell.url = stream.url;
														cell.quality = stream_json.quality || element.qualitys;
														cell.subtitles = stream.subtitles;
														self.orUrlReserve(cell);
														self.setDefaultQuality(cell);
														element.mark();
													}
													else {
														cell.url = '';
														Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
													}
													call();
												}, () => {
													cell.url = '';
													call();
												});
											};
										}
									}
									else
										cell.url = element.url;

									self.orUrlReserve(cell);
									self.setDefaultQuality(cell);
									playlist.push(cell);
								}); //Lampa.Player.playlist(playlist)
							}
							else
								playlist.push(first);

							if (playlist.length > 1)
								first.playlist = playlist;

							if (first.url) {
								// @todo: check debugger and remove if useless so
								let element = first;
								element.isonline = true;
								if (element.url && element.isonline) {
									// online.js
								}
								else if (element.url) {
									if (Platform.is('browser') && location.host.indexOf("127.0.0.1") !== -1) {
										Noty.show('Видео открыто в playerInner', { time: 3000 });
										$.get('http://rc.bwa.to/player-inner/' + element.url);
										return;
									}

									Player.play(element);
								}
								Lampa.Player.play(first);
								Lampa.Player.playlist(playlist);
								item.mark();
								self.updateBalancer(activeBalancer);
							}
							else
								Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
						}
						else
							Lampa.Noty.show(Lampa.Lang.translate('qwatch_no_link'));
					}, true);
				},
				onContextMenu: (item, html, data, call) => {
					self.getFileUrl(item, (stream) => {
						call({
							file: stream.url,
							quality: item.qualitys
						});
					}, true);
				}
			});
			this.filter({
				season: filter_find.season.map((s) => {
					return s.title;
				}),
				voice: filter_find.voice.map((b) => {
					return b.title;
				})
			}, this.getChoice());
		};
		this.parse = function (jsonDataString) {
			let json = (Lampa.Arrays.isObject(jsonDataString) && jsonDataString.rch) ? jsonDataString : Lampa.Arrays.decodeJson(jsonDataString, {});
			if (json.rch)
				return this.rch(json);

			try {
				let videoItems = this.parseJsonData(jsonDataString, '.videos__item');
				let videoButtons = this.parseJsonData(jsonDataString, '.videos__button');

				if (videoItems.length == 1 && videoItems[0].method == 'link' && !videoItems[0].similar) {
					filter_find.season = videoItems.map((s) => {
						return {
							title: s.text,
							url: s.url
						};
					});
					this.replaceChoice({
						season: 0
					});
					this.request(videoItems[0].url);
				}
				else {
					this.activity.loader(false);

					let videos = videoItems.filter((videoItem) => {
						return videoItem.method == 'play' || videoItem.method == 'call';
					});
					let videosSimilar = videoItems.filter((videoItem) => {
						return videoItem.similar;
					});

					if (videos.length) {
						if (videoButtons.length) {
							filter_find.voice = videoButtons.map((b) => {
								return {
									title: b.text,
									url: b.url
								};
							});
							let select_voice_url = this.getChoice(activeBalancer).voice_url;
							let select_voice_name = this.getChoice(activeBalancer).voice_name;
							let find_voice_url = videoButtons.find((v) => {
								return v.url == select_voice_url;
							});
							let find_voice_name = videoButtons.find((v) => {
								return v.text == select_voice_name;
							});
							let find_voice_active = videoButtons.find((v) => {
								return v.active;
							});

							if (find_voice_url && !find_voice_url.active) {
								this.replaceChoice({
									voice: videoButtons.indexOf(find_voice_url),
									voice_name: find_voice_url.text
								});
								this.request(find_voice_url.url);
							}
							else if (find_voice_name && !find_voice_name.active) {
								this.replaceChoice({
									voice: videoButtons.indexOf(find_voice_name),
									voice_name: find_voice_name.text
								});
								this.request(find_voice_name.url);
							}
							else {
								if (find_voice_active) {
									this.replaceChoice({
										voice: videoButtons.indexOf(find_voice_active),
										voice_name: find_voice_active.text
									});
								}
								this.display(videos);
							}
						}
						else {
							this.replaceChoice({
								voice: 0,
								voice_url: '',
								voice_name: ''
							});
							this.display(videos);
						}
					}
					else if (videoItems.length) {
						if (videosSimilar.length) {
							this.similars(videosSimilar);
							this.activity.loader(false);
						}
						else { //this.activity.loader(true)
							filter_find.season = videoItems.map((s) => {
								return {
									title: s.text,
									url: s.url
								};
							});
							let select_season = this.getChoice(activeBalancer).season;
							let season = filter_find.season[select_season] || filter_find.season[0]; // @test: ||
							//if (!season) season = filter_find.season[0];
							this.request(season.url);
						}
					}else
						this.showNoAnswerPage(json);
				}
			}
			catch (err) {
				this.showNoAnswerPage(err);
			}
		};
		this.similars = function (json) {
			let self = this;
			scroll.clear();
			json.forEach((element) => {
				element.title = element.text;
				element.details = '';

				let details = [];
				let year = ((element.start_date || element.year || object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4);
				if (year)
					details.push(year);
				if (element.details)
					details.push(element.details);

				let name = element.title || element.text;
				element.title = name;
				element.time = element.time || '';
				element.details = details.join('<span class="qwatch-split">●</span>');
				let itemElement = Lampa.Template.get('qwatch_page_folder', element);
				if (element.img) {
					let imageElement = $('<img style="height: 7em; width: 7em; border-radius: 0.3em;"/>');
					itemElement.find('.qwatch-item__folder').empty().append(imageElement);

					if (element.img !== undefined) {
						if (element.img.charAt(0) === '/')
							element.img = hostAddress + element.img.substring(1);
						if (element.img.indexOf('/proxyimg') !== -1)
							element.img = account(element.img);
					}

					Lampa.Utils.imgLoad(imageElement, element.img);
				}
				itemElement.on('hover:enter', () => {
					self.reset();
					self.request(element.url);
				}).on('hover:focus', (event) => {
					last = event.target;
					scroll.update($(event.target), true);
				});
				scroll.append(itemElement);
			});
			this.filter({
				season: filter_find.season.map((s) => {
					return s.title;
				}),
				voice: filter_find.voice.map((b) => {
					return b.title;
				})
			}, this.getChoice());
			Lampa.Controller.enable('content');
		};
		// @todo: instead use 'online_filter'?
		this.getChoice = function (targetBalancer) {
			let choicesCache = Lampa.Storage.cache('qwatch_choice_' + (targetBalancer || activeBalancer), 3000, {});
			let choice = choicesCache[object.movie.id] || {};
			Lampa.Arrays.extend(choice, {
				season: 0,
				voice: 0,
				voice_name: '',
				voice_id: 0,
				episodes_view: {},
				movie_view: ''
			});
			return choice;
		};
		this.saveChoice = function (choice, targetBalancer) {
			let choicesChache = Lampa.Storage.cache('qwatch_choice_' + (targetBalancer || activeBalancer), 3000, {});
			choicesChache[object.movie.id] = choice;
			Lampa.Storage.set('qwatch_choice_' + (targetBalancer || activeBalancer), choicesChache);
			this.updateBalancer(targetBalancer || activeBalancer);
		};
		this.replaceChoice = function (choice, targetBalancer) {
			let destinationChoice = this.getChoice(targetBalancer);
			Lampa.Arrays.extend(destinationChoice, choice, true);
			this.saveChoice(destinationChoice, targetBalancer);
		};
		this.clearImages = function () {
			images.forEach((img) => {
				img.onerror = function () { };
				img.onload = function () { };
				img.src = '';
			});
			images = [];
		};
		/**
		 * Очистить список файлов
		 */
		this.reset = function () {
			last = false;
			clearInterval(balancer_timer);
			network.clear();
			this.clearImages();
			scroll.render().find('.empty').remove();
			scroll.clear();
			scroll.reset();
			scroll.body().append(Lampa.Template.get('qwatch_page_content_loader'));
		};
		/**
		 * Загрузка
		 */
		this.setLoading = function (status) {
			if (status) this.activity.loader(true);
			else {
				this.activity.loader(false);
				this.activity.toggle();
			}
		};
		/**
		 * Построить фильтр
		 */
		this.filter = function (filter_items, choice) {
			let self = this;

			let select = [];
			let add = (type, title) => {
				let need = self.getChoice();
				let items = filter_items[type];
				let subitems = [];
				let value = need[type];

				items.forEach((name, i) => {
					subitems.push({
						title: name,
						selected: value == i,
						index: i
					});
				});

				select.push({
					title: title,
					subtitle: items[value],
					items: subitems,
					stype: type
				});
			};
			filter_items.source = filter_sources;
			select.push({
				title: Lampa.Lang.translate('torrent_parser_reset'),
				reset: true
			});
			this.saveChoice(choice);
			if (filter_items.voice && filter_items.voice.length)
				add('voice', Lampa.Lang.translate('torrent_parser_voice'));
			if (filter_items.season && filter_items.season.length)
				add('season', Lampa.Lang.translate('torrent_serial_season'));
			filter.set('filter', select);
			filter.set('sort', filter_sources.map((e) => {
				return {
					title: sources[e].name,
					source: e,
					selected: e == activeBalancer,
					ghost: !sources[e].show
				};
			}));
			this.selected(filter_items);
		};
		/**
		 * Показать что выбрано в фильтре
		 */
		this.selected = function (filter_items) {
			let need = this.getChoice();
			let select = [];

			for (let i in need) {
				if (filter_items[i] && filter_items[i].length) {
					if (i == 'voice')
						select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]);
					else if (i !== 'source' && filter_items.season.length >= 1)
						select.push(filter_translate.season + ': ' + filter_items[i][need[i]]);
				}
			}

			filter.chosen('filter', select);
			filter.chosen('sort', [sources[activeBalancer].name]);
		};
		this.getEpisodes = function (season, call) {
			let episodes = [];
			if (['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1)
				return call(episodes);

			if (typeof object.movie.id == 'number' && object.movie.name) {
				let tmdbUrl = Lampa.TMDB.api('tv/' + object.movie.id + '/season/' + season + '?api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('language', 'ru'));
				network.timeout(1000 * 10);
				network["native"](tmdbUrl, (data) => {
					episodes = data.episodes || [];
					call(episodes);
				}, (a, c) => {
					call(episodes);
				});
			}
			else
				call(episodes);
		};
		this.getWatched = function () {
			let videoId = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			let watchedList = Lampa.Storage.cache('qwatch_watched_last', 5000, {});
			return watchedList[videoId];
		};
		this.setWatched = function (entry) {
			let videoId = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
			let watchedList = Lampa.Storage.cache('qwatch_watched_last', 5000, {});
			if (!watchedList[videoId])
				watchedList[videoId] = {};
			Lampa.Arrays.extend(watchedList[videoId], entry, true);
			Lampa.Storage.set('qwatch_watched_last', watchedList);
			this.updateWatched();
		};
		this.updateWatched = function () {
			let watchedItem = this.getWatched();
			let body = scroll.body().find('.qwatch-watched .qwatch-watched__body').empty();
			if (watchedItem) {
				let lines = [];
				if (watchedItem.balancer_name)
					lines.push(watchedItem.balancer_name);
				if (watchedItem.voice_name)
					lines.push(watchedItem.voice_name);
				if (watchedItem.season)
					lines.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + watchedItem.season);
				if (watchedItem.episode)
					lines.push(Lampa.Lang.translate('torrent_serial_episode') + ' ' + watchedItem.episode);

				lines.forEach((lineText) => {
					body.append('<span>' + lineText + '</span>');
				});
			}
			else
				body.append('<span>' + Lampa.Lang.translate('qwatch_no_watch_history') + '</span>');
		};
		/**
		 * Отрисовка файлов
		 */
		this.draw = function (items) {
			let self = this;
			let params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
			if (!items.length)
				return this.showEmptyPage();

			scroll.clear();
			if (!object.balancer)
				scroll.append(Lampa.Template.get('qwatch_page_watched', {}));

			this.updateWatched();
			this.getEpisodes(items[0].season, (episodes) => {
				let viewList = Lampa.Storage.cache('online_view', 5000, []);
				let isSerial = object.movie.name ? true : false;
				let choice = self.getChoice();
				let fully = window.innerWidth > 480;
				let scroll_to_element = false;
				let scroll_to_mark = false;

				items.forEach((element, index) => {
					let episode = isSerial && episodes.length && !params.similars ? episodes.find((e) => {
						return e.episode_number == element.episode;
					}) : false;
					let episode_num = element.episode || index + 1;
					let episode_last = choice.episodes_view[element.season];
					let voice_name = choice.voice_name || (filter_find.voice[0] ? filter_find.voice[0].title : false) || element.voice_name || (isSerial ? 'Неизвестно' : element.text) || 'Неизвестно';
					if (element.quality) {
						element.qualitys = element.quality;
						element.quality = Lampa.Arrays.getKeys(element.quality)[0];
					}

					Lampa.Arrays.extend(element, {
						voice_name: voice_name,
						details: voice_name.length > 60 ? voice_name.substr(0, 60) + '...' : voice_name,
						quality: '',
						time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
					});

					let hash_timeline = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);
					let hash_behold = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join('') : object.movie.original_title + element.voice_name);
					let data = {
						hash_timeline: hash_timeline,
						hash_behold: hash_behold
					};

					let details = [];
					if (element.season) {
						element.translate_episode_end = self.getLastEpisode(items);
						element.translate_voice = element.voice_name;
					}
					if (element.text && !episode)
						element.title = element.text;
					element.timeline = Lampa.Timeline.view(hash_timeline);

					if (episode) {
						element.title = episode.name;

						if (element.details.length < 30 && episode.vote_average)
							details.push(Lampa.Template.get('qwatch_item_rating', {
								rate: parseFloat(episode.vote_average + '').toFixed(1)
							}, true));

						if (episode.air_date && fully)
							details.push(Lampa.Utils.parseTime(episode.air_date).full);
					}
					else if (object.movie.release_date && fully)
						details.push(Lampa.Utils.parseTime(object.movie.release_date).full);

					if (!isSerial && object.movie.tagline && element.details.length < 30)
						details.push(object.movie.tagline);
					if (element.details)
						details.push(element.details);
					if (details.length)
						element.details = details.map((d) => {
							return '<span>' + d + '</span>';
						}).join('<span class="qwatch-split">●</span>');

					let html = Lampa.Template.get('qwatch_page_full', element);
					let loader = html.find('.qwatch__loader');
					let image = html.find('.qwatch-item__img');
					if (object.balancer)
						image.hide();

					if (!isSerial) {
						if (choice.movie_view == hash_behold)
							scroll_to_element = html;
					}
					else if (episode_last !== undefined && episode_last == episode_num)
						scroll_to_element = html;

					if (isSerial && !episode) {
						image.append('<div class="qwatch-item__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
						loader.remove();
					}
					else if (!isSerial && ['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1)
						loader.remove();
					else {
						var thumbnail = html.find('img')[0];
						thumbnail.onerror = () => {
							thumbnail.src = './img/img_broken.svg';
						};
						thumbnail.onload = () => {
							image.addClass('qwatch-item__img--loaded');
							loader.remove();
							if (isSerial)
								image.append('<div class="qwatch-item__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
						};
						thumbnail.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
						images.push(thumbnail);
					}

					html.find('.qwatch-item__timeline').append(Lampa.Timeline.render(element.timeline));
					if (viewList.indexOf(hash_behold) !== -1) {
						scroll_to_mark = html;
						html.find('.qwatch-item__img').append('<div class="qwatch-item__watched">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
					}

					element.mark = () => {
						// @note: 'online_view' is internal variable that affects other aspects
						viewList = Lampa.Storage.cache('online_view', 5000, []);
						if (viewList.indexOf(hash_behold) == -1) {
							viewList.push(hash_behold);
							Lampa.Storage.set('online_view', viewList);
							if (html.find('.qwatch-item__watched').length == 0)
								html.find('.qwatch-item__img').append('<div class="qwatch-item__watched">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
						}

						choice = self.getChoice();
						if (!isSerial)
							choice.movie_view = hash_behold;
						else
							choice.episodes_view[element.season] = episode_num;
						self.saveChoice(choice);

						let voice_name_text = (choice.voice_name || element.voice_name || element.title);
						if (voice_name_text.length > 30)
							voice_name_text = voice_name_text.slice(0, 30) + '...';

						self.setWatched({
							balancer: activeBalancer,
							balancer_name: Lampa.Utils.capitalizeFirstLetter(sources[activeBalancer] ? sources[activeBalancer].name.split(' ')[0] : activeBalancer),
							voice_id: choice.voice_id,
							voice_name: voice_name_text,
							episode: element.episode,
							season: element.season
						});
					};
					element.unmark = () => {
						// @note: 'online_view' is internal variable that affects other aspects
						viewList = Lampa.Storage.cache('online_view', 5000, []);
						if (viewList.indexOf(hash_behold) !== -1) {
							Lampa.Arrays.remove(viewList, hash_behold);
							Lampa.Storage.set('online_view', viewList);
							Lampa.Storage.remove('online_view', hash_behold);
							html.find('.qwatch-item__watched').remove();
						}
					};
					element.timeclear = () => {
						element.timeline.percent = 0;
						element.timeline.time = 0;
						element.timeline.duration = 0;
						Lampa.Timeline.update(element.timeline);
					};

					html.on('hover:enter', () => {
						if (object.movie.id)
							Lampa.Favorite.add('history', object.movie, 100);
						if (params.onEnter)
							params.onEnter(element, html, data);
					}).on('hover:focus', (event) => {
						last = event.target;
						if (params.onFocus)
							params.onFocus(element, html, data);
						scroll.update($(event.target), true);
					});
					if (params.onRender)
						params.onRender(element, html, data);

					self.contextMenu({
						html: html,
						element: element,
						onFile: (call) => {
							if (params.onContextMenu)
								params.onContextMenu(element, html, data, call);
						},
						onClearAllMark: () => {
							items.forEach(function (elem) {
								elem.unmark();
							});
						},
						onClearAllTime: () => {
							items.forEach((elem) => {
								elem.timeclear();
							});
						}
					});
					scroll.append(html);
				});

				if (isSerial && episodes.length > items.length && !params.similars) {
					let left = episodes.slice(items.length);
					left.forEach((episode) => {
						let details = [];
						if (episode.vote_average)
							details.push(Lampa.Template.get('qwatch_item_rating', {
								rate: parseFloat(episode.vote_average + '').toFixed(1)
							}, true));
						if (episode.air_date)
							details.push(Lampa.Utils.parseTime(episode.air_date).full);

						let airDate = new Date((episode.air_date + '').replace(/-/g, '/'));
						let daysLeft = Math.round((airDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
						let daysLeftText = Lampa.Lang.translate('full_episode_days_left') + ': ' + daysLeft;
						let html = Lampa.Template.get('qwatch_page_full', {
							title: episode.name,
							time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true),
							details: details.length ? details.map((d) => {
								return '<span>' + d + '</span>';
							}).join('<span class="qwatch-split">●</span>') : '',
							quality: daysLeft > 0 ? daysLeftText : ''
						});

						let loader = html.find('.qwatch__loader');
						let image = html.find('.qwatch-item__img');
						let season = items[0] ? items[0].season : 1;
						html.find('.qwatch-item__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join('')))));
						let thumbnail = html.find('img')[0];
						if (episode.still_path) {
							thumbnail.onerror = () => {
								thumbnail.src = './img/img_broken.svg';
							};
							thumbnail.onload = () => {
								image.addClass('qwatch-item__img--loaded');
								loader.remove();
								image.append('<div class="qwatch-item__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
							};
							thumbnail.src = Lampa.TMDB.image('t/p/w300' + episode.still_path);
							images.push(thumbnail);
						}
						else {
							loader.remove();
							image.append('<div class="qwatch-item__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
						}

						html.on('hover:focus', (event) => {
							last = event.target;
							scroll.update($(event.target), true);
						});
						html.css('opacity', '0.5');
						scroll.append(html);
					});
				}

				if (scroll_to_element)
					last = scroll_to_element[0];
				else if (scroll_to_mark)
					last = scroll_to_mark[0];

				Lampa.Controller.enable('content');
			});
		};
		/**
		 * Меню
		 */
		this.contextMenu = function (params) {
			params.html.on('hover:long', () => {
				function show(extra) {
					let enabled = Lampa.Controller.enabled().name;
					let menu = [];
					if (Lampa.Platform.is('webos')) {
						menu.push({
							title: Lampa.Lang.translate('player_lauch') + ' - WebOS',
							player: 'webos'
						});
					}
					else if (Lampa.Platform.is('android')) {
						menu.push({
							title: Lampa.Lang.translate('player_lauch') + ' - Android',
							player: 'android'
						});
					}
					menu.push({
						title: Lampa.Lang.translate('player_lauch') + ' - Lampa',
						player: 'lampa'
					});
					menu.push({
						title: Lampa.Lang.translate('qwatch_video'),
						separator: true
					});
					menu.push({
						title: Lampa.Lang.translate('torrent_parser_label_title'),
						mark: true
					});
					menu.push({
						title: Lampa.Lang.translate('torrent_parser_label_cancel_title'),
						unmark: true
					});
					menu.push({
						title: Lampa.Lang.translate('time_reset'),
						timeclear: true
					});
					if (extra) {
						menu.push({
							title: Lampa.Lang.translate('copy_link'),
							copylink: true
						});
					}
					if (window.qwatch_online_context_menu)
						window.qwatch_online_context_menu.push(menu, extra, params);
					menu.push({
						title: Lampa.Lang.translate('more'),
						separator: true
					});
					if (Lampa.Account.logged() && params.element && params.element.season !== undefined && params.element.translate_voice) {
						menu.push({
							title: Lampa.Lang.translate('qwatch_voice_subscribe'),
							subscribe: true
						});
					}
					menu.push({
						title: Lampa.Lang.translate('qwatch_clear_all_marks'),
						clearallmark: true
					});
					menu.push({
						title: Lampa.Lang.translate('qwatch_clear_all_timecodes'),
						timeclearall: true
					});

					Lampa.Select.show({
						title: Lampa.Lang.translate('title_action'),
						items: menu,
						onBack: () => {
							Lampa.Controller.toggle(enabled);
						},
						onSelect: (a) => {
							// process entries callbacks @todo: better to rework this
							if (a.mark) params.element.mark();
							if (a.unmark) params.element.unmark();
							if (a.timeclear) params.element.timeclear();
							if (a.clearallmark) params.onClearAllMark();
							if (a.timeclearall) params.onClearAllTime();

							if (window.qwatch_online_context_menu)
								window.qwatch_online_context_menu.onSelect(a, params);

							Lampa.Controller.toggle(enabled);

							if (a.player) {
								Lampa.Player.runas(a.player);
								params.html.trigger('hover:enter');
							}

							if (a.copylink) {
								if (extra.quality) {
									let qualities = [];
									for (let i in extra.quality) {
										qualities.push({
											title: i,
											file: extra.quality[i]
										});
									}

									Lampa.Select.show({
										title: Lampa.Lang.translate('settings_server_links'),
										items: qualities,
										onBack: () => {
											Lampa.Controller.toggle(enabled);
										},
										onSelect: (b) => {
											Lampa.Utils.copyTextToClipboard(b.file, () => {
												Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
											}, () => {
												Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
											});
										}
									});
								}
								else {
									Lampa.Utils.copyTextToClipboard(extra.file, () => {
										Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
									}, () => {
										Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
									});
								}
							}

							if (a.subscribe) {
								Lampa.Account.subscribeToTranslation({
									card: object.movie,
									season: params.element.season,
									episode: params.element.translate_episode_end,
									voice: params.element.translate_voice
								}, () => {
									Lampa.Noty.show(Lampa.Lang.translate('qwatch_voice_success'));
								}, () => {
									Lampa.Noty.show(Lampa.Lang.translate('qwatch_voice_error'));
								});
							}
						}
					});
				}

				params.onFile(show);
			}).on('hover:focus', () => {
				if (Lampa.Helper)
					Lampa.Helper.show('qwatch_file', Lampa.Lang.translate('helper_torrents'), params.html);
			});
		};
		this.showEmptyPage = function () {
			let html = Lampa.Template.get('qwatch_page_no_answer', {});
			html.find('.qwatch-empty__buttons').remove();
			html.find('.qwatch-empty__title').text(Lampa.Lang.translate('empty_title_two'));
			html.find('.qwatch-empty__time').text(Lampa.Lang.translate('empty_text'));
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
		};
		this.showNoConnectPage = function (err) {
			let html = Lampa.Template.get('qwatch_page_no_answer', {});
			html.find('.qwatch-empty__buttons').remove();
			html.find('.qwatch-empty__title').text(Lampa.Lang.translate('title_error'));
			html.find('.qwatch-empty__time').text(err && err.accsdb ? err.msg : Lampa.Lang.translate('qwatch_balancer_no_results').replace('{balancer}', sources[activeBalancer].name));
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
		};
		this.showNoAnswerPage = function (err) {
			let self = this;
			this.reset();
			let html = Lampa.Template.get('qwatch_page_no_answer', {
				balancer: activeBalancer
			});
			if (err && err.accsdb)
				html.find('.qwatch-empty__title').html(err.msg);

			let tic = err && err.accsdb ? 10 : 5;
			html.find('.cancel').on('hover:enter', () => {
				clearInterval(balancer_timer);
			});
			html.find('.change').on('hover:enter', () => {
				clearInterval(balancer_timer);
				filter.render().find('.filter--sort').trigger('hover:enter');
			});
			scroll.clear();
			scroll.append(html);
			this.setLoading(false);
			balancer_timer = setInterval(() => {
				tic--;
				html.find('.timeout').text(tic);
				if (tic == 0) {
					clearInterval(balancer_timer);
					let keys = Lampa.Arrays.getKeys(sources);
					let next = keys[keys.indexOf(activeBalancer) + 1];
					if (!next)
						next = keys[0];
					activeBalancer = next;
					if (Lampa.Activity.active().activity == self.activity)
						self.changeBalancer(activeBalancer);
				}
			}, 1000);
		};
		this.getLastEpisode = function (items) {
			let last_episode = 0;
			items.forEach((e) => {
				if (e.episode !== undefined)
					last_episode = Math.max(last_episode, parseInt(e.episode));
			});
			return last_episode;
		};
		/**
		 * Начать навигацию по файлам
		 */
		this.start = function () {
			if (Lampa.Activity.active().activity !== this.activity)
				return;

			if (!initialized) {
				initialized = true;
				this.initialize();
			}

			Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
			Lampa.Controller.add('content', {
				toggle: () => {
					Lampa.Controller.collectionSet(scroll.render(), files.render());
					Lampa.Controller.collectionFocus(last || false, scroll.render());
				},
				gone: () => {
					clearTimeout(balancer_timer);
				},
				up: () => {
					if (Navigator.canmove('up'))
						Navigator.move('up');
					else
						Lampa.Controller.toggle('head');
				},
				down: () => {
					Navigator.move('down');
				},
				right: () => {
					if (Navigator.canmove('right'))
						Navigator.move('right');
					else
						filter.show(Lampa.Lang.translate('title_filter'), 'filter');
				},
				left: () => {
					if (Navigator.canmove('left'))
						Navigator.move('left');
					else
						Lampa.Controller.toggle('menu');
				},
				back: this.back.bind(this)
			});
			Lampa.Controller.toggle('content');
		};
		this.render = function () {
			return files.render();
		};
		this.back = function () {
			Lampa.Activity.backward();
		};
		this.pause = function () { };
		this.stop = function () { };
		this.destroy = function () {
			network.clear();
			this.clearImages();
			files.destroy();
			scroll.destroy();
			clearInterval(balancer_timer);
			clearTimeout(life_wait_timer);
			if (hubConnection) {
				clearTimeout(hubTimer);
				hubConnection.stop();
				hubConnection = null;
			}
		};
	}

	function addSourceSearch(spiderName, spiderUri) {
		let network = new Lampa.Reguest();

		let source = {
			title: spiderName,
			search: (params, onComplete) => {
				function searchComplite(links) {
					let keys = Lampa.Arrays.getKeys(links);

					if (keys.length) {
						let status = new Lampa.Status(keys.length);

						status.onComplite = (result) => {
							let rows = [];

							keys.forEach((name) => {
								let line = result[name];

								if (line && line.data && line.type == 'similar') {
									let cards = line.data.map((item) => {
										item.title = Lampa.Utils.capitalizeFirstLetter(item.title);
										item.release_date = item.year || '0000';
										item.balancer = spiderUri;
										if (item.img !== undefined) {
											if (item.img.charAt(0) === '/')
												item.img = hostAddress + item.img.substring(1);
											if (item.img.indexOf('/proxyimg') !== -1)
												item.img = account(item.img);
										}

										return item;
									});

									rows.push({
										title: name,
										results: cards
									});
								}
							})

							onComplete(rows);
						}

						keys.forEach((name) => {
							network.silent(account(links[name]), (data) => {
								status.append(name, data);
							}, () => {
								status.error();
							})
						})
					}
					else
						onComplete([]);
				}

				network.silent(account(hostAddress + 'lite/' + spiderUri + '?title=' + params.query), (json) => {
					if (json.rch) {
						rchRun(json, () => {
							network.silent(account(hostAddress + 'lite/' + spiderUri + '?title=' + params.query), (links) => {
								searchComplite(links);
							}, () => {
								onComplete([]);
							});
						});
					}
					else
						searchComplite(json);
				}, () => {
					onComplete([]);
				});
			},
			onCancel: () => {
				network.clear()
			},
			params: {
				lazy: true,
				align_left: true,
				card_events: {
					onMenu: () => { }
				}
			},
			onMore: (params, close) => {
				close();
			},
			onSelect: (params, close) => {
				close();

				Lampa.Activity.push({
					url: params.element.url,
					title: 'QWatch - ' + params.element.title,
					component: 'qwatch',
					movie: params.element,
					page: 1,
					search: params.element.title,
					clarification: true,
					balancer: params.element.balancer,
					noinfo: true
				});
			}
		}

		Lampa.Search.addSource(source)
	}

	function startPlugin() {
		window.plugin_qwatch_ready = true;

		let manifest = {
			type: 'video',
			version: '1.0.0',
			name: 'QWatch',
			description: 'Плагин для онлайн просмотра фильмов и сериалов',
			component: 'qwatch'
		};
		Lampa.Manifest.plugins = manifest;

		Lampa.Lang.add({
			qwatch_title: {
				ru: 'Онлайн',
				uk: 'Онлайн',
				en: 'Online',
				zh: '在线的'
			},
			qwatch_video: {
				ru: 'Видео',
				en: 'Video',
				uk: 'Відео',
				zh: '视频'
			},
			qwatch_no_watch_history: {
				ru: 'Нет истории просмотра',
				en: 'No browsing history',
				ua: 'Немає історії перегляду',
				zh: '没有浏览历史'
			},
			qwatch_no_link: {
				ru: 'Не удалось извлечь ссылку',
				uk: 'Неможливо отримати посилання',
				en: 'Failed to fetch link',
				zh: '获取链接失败'
			},
			qwatch_balancer: {
				ru: 'Источник',
				uk: 'Джерело',
				en: 'Source',
				zh: '来源'
			},
			qwatch_voice_subscribe: {
				ru: 'Подписаться на перевод',
				uk: 'Підписатися на переклад',
				en: 'Subscribe to translation',
				zh: '订阅翻译'
			},
			qwatch_voice_success: {
				ru: 'Вы успешно подписались',
				uk: 'Ви успішно підписалися',
				en: 'You have successfully subscribed',
				zh: '您已成功订阅'
			},
			qwatch_voice_error: {
				ru: 'Возникла ошибка',
				uk: 'Виникла помилка',
				en: 'An error has occurred',
				zh: '发生了错误'
			},
			qwatch_clear_all_marks: {
				ru: 'Очистить все метки',
				uk: 'Очистити всі мітки',
				en: 'Clear all labels',
				zh: '清除所有标签'
			},
			qwatch_clear_all_timecodes: {
				ru: 'Очистить все тайм-коды',
				uk: 'Очистити всі тайм-коди',
				en: 'Clear all timecodes',
				zh: '清除所有时间代码'
			},
			qwatch_balancer_change: {
				ru: 'Изменить балансер',
				uk: 'Змінити балансер',
				en: 'Change balancer',
				zh: '更改平衡器'
			},
			qwatch_balancer_timeout: {
				ru: 'Источник будет переключен автоматически через <span class="timeout">10</span> секунд.',
				uk: 'Джерело буде автоматично переключено через <span class="timeout">10</span> секунд.',
				en: 'The source will be switched automatically after <span class="timeout">10</span> seconds.',
				zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
			},
			qwatch_balancer_no_results: {
				ru: 'Поиск на "{balancer}" не дал результатов',
				uk: 'Пошук на "{balancer}" не дав результатів',
				en: 'Search on "{balancer}" did not return any results',
				zh: '搜索 "{balancer}" 未返回任何结果'
			}
		});

		// register css styles
		Lampa.Template.add('qwatch_css',
			'<style>' +
			'@charset \'UTF-8\';' +
			'.qwatch-item{position:relative;-webkit-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}' +
			'.qwatch-item__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}' +
			'@media screen and (max-width:480px){.qwatch-item__body{padding:.8em 1.2em}}' +
			'.qwatch-item__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}' +
			'.qwatch-item__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-top-left-radius:.3em;-webkit-border-bottom-left-radius:.3em;border-top-left-radius:.3em;border-bottom-left-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}' +
			'.qwatch-item__img--loaded>img{opacity:1}@media screen and (max-width:480px){.qwatch-item__img{width:7em;min-height:6em}}' +
			'.qwatch-item__folder{padding:1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
			'.qwatch-item__folder>svg{width:4.4em !important;height:4.4em !important}' +
			'.qwatch-item__watched{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);-webkit-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}' +
			'.qwatch-item__watched>svg{width:1.5em !important;height:1.5em !important}' +
			'.qwatch-item__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em}' +
			'.qwatch__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-o-background-size:contain;background-size:contain}' +
			'.qwatch-item__head,.qwatch-item__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch-item__timeline{margin:.8em 0}' +
			'.qwatch-item__timeline>.time-line{display:block !important}' +
			'.qwatch-item__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}' +
			'@media screen and (max-width:480px){.qwatch-item__title{font-size:1.4em}}' +
			'.qwatch-item__time{padding-left:2em}' +
			'.qwatch-item__details{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch-item__details>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}' +
			'.qwatch-item__quality{padding-left:1em;white-space:nowrap}' +
			'.qwatch-item .qwatch-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}' +
			'.qwatch-item.focus::after{content:\'\';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}' +
			'.qwatch-item+.qwatch-item{margin-top:1.5em}' +
			'.qwatch-item--folder .qwatch-item__footer{margin-top:.8em}' +
			'.qwatch-watched{padding:1em}' +
			'.qwatch-watched__icon>svg{width:1.5em;height:1.5em}' +
			'.qwatch-watched__body{padding-left:1em;padding-top:.1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}' +
			'.qwatch-watched__body>span+span::before{content:\' ● \';vertical-align:top;display:inline-block;margin:0 .5em}' +
			'.qwatch-item__rating{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}' +
			'.qwatch-item__rating>svg{width:1.3em !important;height:1.3em !important}' +
			'.qwatch-item__rating>span{font-weight:600;font-size:1.1em;padding-left:.5em}' +
			'.qwatch-empty{line-height:1.4}' +
			'.qwatch-empty__title{font-size:1.8em;margin-bottom:.3em}' +
			'.qwatch-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}' +
			'.qwatch-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}' +
			'.qwatch-empty__buttons>*+*{margin-left:1em}' +
			'.qwatch-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}' +
			'.qwatch-empty__button.focus{background:#fff;color:black}' +
			'.qwatch-empty__list .qwatch-empty-skeleton:nth-child(2){opacity:.5}' +
			'.qwatch-empty__list .qwatch-empty-skeleton:nth-child(3){opacity:.2}' +
			'.qwatch-empty-skeleton{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;border-radius:.3em}' +
			'.qwatch-empty-skeleton>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;border-radius:.3em}' +
			'.qwatch-empty-skeleton__ico{width:4em;height:4em;margin-right:2.4em}' +
			'.qwatch-empty-skeleton__body{height:1.7em;width:70%}' +
			'.qwatch-empty-skeleton+.qwatch-empty-skeleton{margin-top:1em}' +
			'</style>');
		$('body').append(Lampa.Template.get('qwatch_css', {}, true));

		Lampa.Listener.add('full', (event) => {
			if (event.type != 'complite')
				return;

			// render button
			var onlineButton = $(Lampa.Lang.translate(
				'<div class="full-start__button selector view--qwatch" data-subtitle="' + manifest.name + ' ' + manifest.version + '">' +
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="currentColor" fill-rule="evenodd" d="M3.07 6a8.025 8.025 0 014.262-3.544A12.802 12.802 0 005.595 6H3.07zm-.818 2A8.015 8.015 0 002 10c0 .69.088 1.36.252 2h2.89A13.886 13.886 0 015 10c0-.704.051-1.371.143-2H2.252zm4.916 0C7.06 8.62 7 9.286 7 10c0 .713.061 1.38.168 2h5.664c.107-.62.168-1.287.168-2 0-.714-.061-1.38-.168-2H7.168zm7.69 0c.09.629.142 1.296.142 2s-.051 1.371-.143 2h2.891c.165-.64.252-1.31.252-2s-.087-1.36-.252-2h-2.89zm2.072-2h-2.525a12.805 12.805 0 00-1.737-3.544A8.025 8.025 0 0116.93 6zm-4.638 0H7.708c.324-.865.725-1.596 1.124-2.195.422-.633.842-1.117 1.168-1.452.326.335.746.82 1.168 1.452.4.599.8 1.33 1.124 2.195zm-1.124 10.195c.4-.599.8-1.33 1.124-2.195H7.708c.324.865.725 1.596 1.124 2.195.422.633.842 1.117 1.168 1.452.326-.335.746-.82 1.168-1.452zM3.07 14h2.525a12.802 12.802 0 001.737 3.544A8.025 8.025 0 013.07 14zm9.762 3.305a12.9 12.9 0 01-.164.24A8.025 8.025 0 0016.93 14h-2.525a12.805 12.805 0 01-1.573 3.305zM20 10c0 5.52-4.472 9.994-9.99 10h-.022C4.47 19.994 0 15.519 0 10 0 4.477 4.477 0 10 0s10 4.477 10 10z"/></svg>' +
				'<span>#{qwatch_title}</span>' +
				'</div>'));
			var render = event.object.activity.render();
			var torrentButton = render.find('.view--torrent');
			if (torrentButton.length)
				torrentButton.before(onlineButton);
			else
				render.find('.full-start__button:last').after(onlineButton);

			// register button action
			onlineButton.on('hover:enter', () => {
				// register templates
				Lampa.Template.add('qwatch_page_full', 
				'<div class="qwatch-item selector">' +
					'<div class="qwatch-item__img">' +
						'<img alt="">' +
						'<div class="qwatch__loader"/>' +
					'</div>' +
					'<div class="qwatch-item__body">' +
						'<div class="qwatch-item__head">' +
							'<div class="qwatch-item__title">{title}</div>' +
							'<div class="qwatch-item__time">{time}</div>' +
						'</div>' +
						'<div class="qwatch-item__timeline"/>' +
						'<div class="qwatch-item__footer">' +
							'<div class="qwatch-item__details">{details}</div>' +
							'<div class="qwatch-item__quality">{quality}</div>' +
						'</div>' +
					'</div>' +
				'</div>');
				Lampa.Template.add('qwatch_page_content_loader',
					'<div class="qwatch-empty">' +
						'<div class="broadcast__scan"><div/></div>' +
						'<div class="qwatch-empty__list">' +
							'<div class="qwatch-empty-skeleton selector">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
						'</div>' +
					'</div>');
				Lampa.Template.add('qwatch_page_no_answer',
					'<div class="qwatch-empty">' +
						'<div class="qwatch-empty__title">#{qwatch_balancer_no_results}</div>' +
						'<div class="qwatch-empty__time">#{qwatch_balancer_timeout}</div>' +
						'<div class="qwatch-empty__buttons">' +
							'<div class="qwatch-empty__button selector cancel">#{cancel}</div>' +
							'<div class="qwatch-empty__button selector change">#{qwatch_balancer_change}</div>' +
						'</div>' +
						'<div class="qwatch-empty__list">' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>'+
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
							'<div class="qwatch-empty-skeleton">' +
								'<div class="qwatch-empty-skeleton__ico"/>' +
								'<div class="qwatch-empty-skeleton__body"/>' +
							'</div>' +
						'</div>' +
					'</div>');
				Lampa.Template.add('qwatch_item_rating', 
					'<div class="qwatch-item__rating">' +
						'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 14" fill="currentColor"><path d="M6.54893 0.927035C6.84828 0.00572455 8.15169 0.00572705 8.45104 0.927038L9.40835 3.87334C9.54223 4.28537 9.92618 4.56433 10.3594 4.56433H13.4573C14.4261 4.56433 14.8288 5.80394 14.0451 6.37334L11.5388 8.19426C11.1884 8.4489 11.0417 8.90027 11.1756 9.31229L12.1329 12.2586C12.4322 13.1799 11.3778 13.946 10.594 13.3766L8.08777 11.5557C7.73728 11.3011 7.26268 11.3011 6.9122 11.5557L4.40592 13.3766C3.6222 13.946 2.56773 13.1799 2.86708 12.2586L3.82439 9.31229C3.95827 8.90027 3.81161 8.4489 3.46112 8.19426L0.954841 6.37334C0.171128 5.80394 0.573906 4.56433 1.54263 4.56433H4.64056C5.07378 4.56433 5.45774 4.28536 5.59161 3.87334L6.54893 0.927035Z"/></svg>' +
						'<span>{rate}</span>' +
					'</div>');
				Lampa.Template.add('qwatch_page_folder', 
					'<div class="qwatch-item qwatch-item--folder selector">' +
						'<div class="qwatch-item__folder">' +
							'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 112" fill="currentColor"><rect y="20" width="128" height="92" rx="13"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill-opacity="0.51"/></svg>' +
						'</div>' +
						'<div class="qwatch-item__body">' +
							'<div class="qwatch-item__head">' +
								'<div class="qwatch-item__title">{title}</div>' +
								'<div class="qwatch-item__time">{time}</div>' +
							'</div>' +
							'<div class="qwatch-item__footer">' +
								'<div class="qwatch-item__details">{details}</div>' +
							'</div>' +
						'</div>' +
					'</div>');
				Lampa.Template.add('qwatch_page_watched', 
					'<div class="qwatch-item qwatch-watched selector">' +
						'<div class="qwatch-watched__icon">' +
							'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"/></svg>' +
						'</div>' +
						'<div class="qwatch-watched__body"/>' +
					'</div>');

				// register component
				Lampa.Component.add('qwatch', QWatchComponent);

				// register activity
				let movieId = Lampa.Utils.hash(event.data.movie.number_of_seasons ? event.data.movie.original_name : event.data.movie.original_title);
				let all = Lampa.Storage.get('clarification_search', '{}');
				Lampa.Activity.push({
					url: '',
					title: Lampa.Lang.translate('qwatch_title'),
					component: 'qwatch',
					search: all[movieId] ? all[movieId] : event.data.movie.title,
					movie: event.data.movie,
					page: 1,
					clarification: all[movieId] ? true : false
				});
			});
		});

		if (Lampa.Manifest.app_digital >= 177) {

			//const balancers_sync = ["filmix", 'filmixtv', "fxapi", "rezka", "rhsprem", "lumex", "videodb", "collaps", "collaps-dash", "hdvb", "zetflix", "kodik", "ashdi", "kinoukr", "kinotochka", "remux", "iframevideo", "cdnmovies", "anilibria", "animedia", "animego", "animevost", "animebesst", "redheadsound", "alloha", "animelib", "moonanime", "kinopub", "vibix", "vdbmovies", "fancdn", "cdnvideohub", "vokino", "rc/filmix", "rc/fxapi", "rc/rhs", "vcdn", "videocdn", "mirage", "hydraflix", "videasy", "vidsrc", "movpi", "vidlink", "twoembed", "autoembed", "smashystream", "autoembed", "rgshows", "pidtor", "videoseed"];
			availableBalancers.forEach((name) => {
				Lampa.Storage.sync('qwatch_choice_' + name, 'object_object');
			});
			Lampa.Storage.sync('qwatch_watched_last', 'object_object');
		}
	}

	/*Lampa.Storage.listener.add('change', function (event) {
		if (event.name == 'activity') {
			if (Lampa.Activity.active().component == 'qwatch') {
				var add_ads = setInterval(function () {
					if (document.querySelector('.qwatch-watched') !== null) {
						$('.qwatch-watched').remove();
						clearInterval(add_ads);
					}
				}, 50);
				var add_ads2 = setInterval(function () {
					if (document.querySelector('.filter--sort') !== null) {
						$('.filter--sort').remove();
						clearInterval(add_ads2);
					}
				}, 50);
			}
		}
	});*/

	if (!window.plugin_qwatch_ready) startPlugin();
})();
